/**
 * THE STATUS PASS, every 15 minutes (and "Refresh statuses" in the admin):
 * the fallback of the webhook, which ShipX may lose during a deploy.
 *
 *   1. creates that never finished (the process died) become `unknown`
 *   2. `unknown` rows are looked up in ShipX (never sent again blindly)
 *   3. open shipments are read again, the oldest read first, at most 100 a
 *      pass and each at most every 25 minutes; shipments in a final status
 *      or older than `pollMaxAgeDays` are left alone
 *   4. with the shipment writer armed and `autoCreate`: pending rows without
 *      problems are created, and confirmed courier pickups are ordered
 *   5. the fulfillment status writer catches up on what it missed
 *   6. the history keeps 120 days
 *
 * Demo mode builds the sample shipments on its first pass and moves the
 * shipments a person created along the simulated timeline.
 */

import { EVENTS_RETENTION_DAYS, SYNC_BATCH, SYNC_EVERY_MS } from "../../modules/inpost/lib/constants"
import type { ParcelRow } from "../../modules/inpost/lib/dto"
import { canCallShipx } from "../../modules/inpost/lib/options"
import { isFinalStatus, isPickedUp } from "../../modules/inpost/lib/statuses"
import { DEMO_SEED_ACTOR } from "../../modules/inpost/lib/demo"
import { ensureDemoSeed } from "./demo"
import { createShipment, lookupUnknown, refreshParcel, requestPickup } from "./parcels"
import { exclusive, inpostService, isArmed, listParcels, recordEvent, storeFor, type Scope } from "./runtime"
import { syncFulfillmentStatus } from "./status-writer"

export interface SyncStats {
  expired: number
  lookedUp: number
  read: number
  changed: number
  created: number
  pickups: number
  marked: number
  pruned: number
  errors: string[]
  skipped?: string
}

const ms = (v: Date | string | null | undefined): number => {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

/** The pass. Null when one already runs in this process. */
export async function runSync(scope: Scope, trigger: "schedule" | "manual"): Promise<SyncStats | null> {
  return exclusive("sync", async () => {
    const svc = inpostService(scope)
    const o = svc.getOptions()
    const demo = o.demo
    const store = storeFor(scope)
    const stats: SyncStats = { expired: 0, lookedUp: 0, read: 0, changed: 0, created: 0, pickups: 0, marked: 0, pruned: 0, errors: [] }
    const note = (label: string, err: unknown) => {
      if (stats.errors.length < 10) stats.errors.push(`${label}: ${svc.mask((err as Error)?.message ?? String(err)).slice(0, 300)}`)
    }
    const started = Date.now()

    if (demo) await ensureDemoSeed(scope).catch((err) => note("demo", err))
    if (!demo && !canCallShipx(o)) {
      stats.skipped = "not_configured"
      return stats
    }

    stats.expired = await store.expireLeases(new Date(), demo)

    if (!demo) {
      for (const row of await listParcels(svc, { demo, state: "unknown" }, { take: 20, order: { updated_at: "ASC" } })) {
        try {
          await lookupUnknown(scope, row.id)
          stats.lookedUp += 1
        } catch (err) {
          note(`lookup ${row.id}`, err)
        }
      }
    }

    const maxAge = Date.now() - o.pollMaxAgeDays * 24 * 3600 * 1000
    const open = (await listParcels(svc, { demo, state: "created" }, { take: SYNC_BATCH * 3, order: { last_checked_at: "ASC" } })).filter(
      (r) =>
        r.shipment_id &&
        !isFinalStatus(r.status) &&
        ms(r.shipment_created_at ?? r.created_at) >= maxAge &&
        (trigger === "manual" || Date.now() - ms(r.last_checked_at) >= SYNC_EVERY_MS) &&
        (!demo || r.created_by !== DEMO_SEED_ACTOR),
    )
    if (o.pollEnabled || trigger === "manual" || demo) {
      for (const row of open.slice(0, SYNC_BATCH)) {
        try {
          const after = await refreshParcel(scope, row.id, "poll")
          stats.read += 1
          if (after.status !== row.status) stats.changed += 1
        } catch (err) {
          note(`read ${row.shipment_id}`, err)
        }
      }
    }

    if (o.autoCreate && (await isArmed(svc, "shipment"))) {
      const pending = (await listParcels(svc, { demo, state: "pending" }, { take: 10, order: { created_at: "ASC" } })).filter((r) => !r.problems || r.problems.length === 0)
      for (const row of pending) {
        try {
          const after = await createShipment(scope, row.id, { actor: "system", trigger: "auto" })
          if (after.state === "created") stats.created += 1
        } catch (err) {
          note(`create ${row.id}`, err)
        }
      }
      try {
        stats.pickups = (await requestPickup(scope, null, "system", "schedule")).parcels
      } catch (err) {
        if (!/pickup_sender_missing|courier pickup needs/i.test(String((err as Error)?.message))) note("pickup", err)
      }
    }

    if (await isArmed(svc, "fulfillmentStatus")) {
      const due = (await listParcels(svc, { demo, state: "created" }, { take: 200, order: { updated_at: "DESC" } })).filter(
        (r: ParcelRow) => r.fulfillment_id && ((isPickedUp(r.status) && !r.shipped_marked_at) || (r.status === "delivered" && !r.delivered_marked_at)),
      )
      for (const row of due.slice(0, 20)) {
        try {
          await syncFulfillmentStatus(scope, row)
          stats.marked += 1
        } catch (err) {
          note(`fulfillment ${row.id}`, err)
        }
      }
    }

    try {
      stats.pruned = await store.pruneEvents(new Date(Date.now() - EVENTS_RETENTION_DAYS * 24 * 3600 * 1000))
    } catch (err) {
      note("prune", err)
    }

    const counts = { read: stats.read, changed: stats.changed, lookedUp: stats.lookedUp, created: stats.created, pickups: stats.pickups, marked: stats.marked, expired: stats.expired, errors: stats.errors.length, durationMs: Date.now() - started }
    await recordEvent(scope, {
      parcel_id: null,
      order_id: null,
      shipment_id: null,
      kind: "run",
      source: trigger,
      message: stats.errors.length > 0 ? stats.errors.join("\n") : null,
      data: counts,
      demo,
    })
    if (stats.changed > 0 || stats.errors.length > 0 || stats.created > 0) {
      svc.getLogger().info(`[inpost] status pass: ${stats.read} read, ${stats.changed} changed, ${stats.created} created, ${stats.errors.length} errors`)
    }
    return stats
  })
}
