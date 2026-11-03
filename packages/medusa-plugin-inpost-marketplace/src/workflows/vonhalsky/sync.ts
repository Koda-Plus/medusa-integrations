/**
 * THE SYNC: what the scheduled job runs (every 5 minutes) and the admin's
 * "Sync now". Each part runs on its own, so one failing never stops the
 * others; each says what it did.
 *
 *   commands    offers whose last write is PENDING: the command is read;
 *               on SUCCESS the offer is read again, on FAILURE the row
 *               says why.
 *   offers      offer events since the last one seen (and offers not read
 *               for a day, events live 72 hours): the offer is read again.
 *   push        listed offers whose Medusa price or stock moved: price and
 *               stock batches, a close at zero stock, a reopen when stock
 *               comes back (the `syncPriceStock` setting).
 *   orders      order events and changed orders: import, update, retry.
 *   cases       returns, claims (no events for those) and refunds.
 *   categories  the tree, weekly.
 *   snapshot    the day's offer counts, once a day.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import type { SyncPart, SyncReport } from "../../modules/vonhalsky/lib/contract"
import { commandPatch, pushPlan, remotePatch } from "../../modules/vonhalsky/lib/offer-sync"
import { newerThan, type RemoteEvent } from "../../modules/vonhalsky/lib/remote"
import { logSync, readSettings, readSyncState, vonHalskySvc, writeSyncState, type Scope } from "../../modules/vonhalsky/lib/store"
import { syncCases } from "./cases"
import { syncCategories } from "./categories"
import { refreshOffers } from "./offers"
import { importNewOrders } from "./orders"
import { clientOf, errorText, optionsOf, requireClient, withLock } from "./runtime"

type Row = Record<string, any>

export type { SyncPart, SyncReport }

export const SYNC_PARTS: readonly SyncPart[] = ["commands", "offers", "push", "orders", "cases", "categories", "snapshot"]

async function listedRows(scope: Scope, filters: Record<string, unknown>, take = 500): Promise<Row[]> {
  return ((await vonHalskySvc(scope).listVonHalskyOffers(filters, { take, order: { synced_at: "ASC" } })) ?? []) as Row[]
}

/** Offers whose last command is still PENDING (at most 200 per run). */
export async function followCommands(scope: Scope): Promise<string> {
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const rows = await listedRows(scope, { command_status: "PENDING" }, 200)
  let done = 0
  let failed = 0
  for (const r of rows) {
    const id = String(r.command_id)
    const c = await (r.command_kind === "program" ? client.campaignCommand(id) : client.offerCommand(id)).catch(() => null)
    if (!c) {
      /* Commands live 24 hours: one the marketplace forgot is read as done and the offer tells the rest. */
      const age = r.command_at ? Date.now() - new Date(r.command_at).getTime() : Infinity
      if (age > 24 * 60 * 60 * 1000) await svc.updateVonHalskyOffers({ id: r.id, command_status: "SUCCESS" })
      continue
    }
    if (c.status === "PENDING") continue
    let patch = commandPatch(r, c)
    if (c.status === "SUCCESS" && r.remote_id) {
      const remote = await client.getOffer(String(r.remote_id)).catch(() => null)
      if (remote) patch = { ...patch, ...remotePatch(r, remote), error: remote.validationErrors.length ? remote.validationErrors[0].message ?? remote.validationErrors[0].code : null }
    }
    await svc.updateVonHalskyOffers({ id: r.id, ...patch })
    if (c.status === "FAILURE") failed += 1
    else done += 1
  }
  return `${rows.length} pending, ${done} done, ${failed} failed`
}

/**
 * Offer events since the last one seen, plus offers not read for a day. The
 * cursor moves only when every offer was read: a failed read is tried again
 * on the next run. An event about an offer we have no remote id for (a
 * create that timed out) links it by its external id, our variant id.
 */
export async function followOffers(scope: Scope): Promise<string> {
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const state = await readSyncState(scope)
  const ids = new Set<string>()
  let newest: string | null = state.offerEventId
  let until: string | null = null
  for (let page = 0; page < 10; page += 1) {
    const batch: RemoteEvent[] = await client.offerEvents({ limit: 100, untilId: until })
    if (page === 0 && batch[0]) newest = batch[0].id
    const { fresh, reachedKnown } = newerThan(batch, state.offerEventId)
    for (const e of fresh) ids.add(e.subjectId)
    if (reachedKnown || batch.length < 100 || !state.offerEventId) break
    until = batch[batch.length - 1].id
  }
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const stale = await listedRows(scope, { remote_id: { $ne: null }, status: { $ne: "draft" }, $or: [{ synced_at: null }, { synced_at: { $lt: day } }] }, 100)
  for (const r of stale) ids.add(String(r.remote_id))
  let updated = 0
  let failed = 0
  let linked = 0
  const list = [...ids].slice(0, 300)
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100)
    const rows = ((await svc.listVonHalskyOffers({ remote_id: part }, { take: 100 })) ?? []) as Row[]
    const known = new Set(rows.map((r) => String(r.remote_id)))
    for (const r of rows) {
      const remote = await client.getOffer(String(r.remote_id)).catch(() => null)
      if (!remote) {
        failed += 1
        continue
      }
      await svc.updateVonHalskyOffers({ id: r.id, ...remotePatch(r, remote) })
      updated += 1
    }
    for (const remoteId of part.filter((x) => !known.has(x))) {
      const remote = await client.getOffer(remoteId).catch(() => null)
      if (!remote?.externalId) continue
      const [row] = ((await svc.listVonHalskyOffers({ variant_id: remote.externalId, remote_id: null }, { take: 1 })) ?? []) as Row[]
      if (!row) continue
      await svc.updateVonHalskyOffers({ id: row.id, remote_id: remote.id, status: "listed", error: null, ...remotePatch({ ...row, remote_id: remote.id }, remote) })
      linked += 1
    }
  }
  const complete = failed === 0 && ids.size <= list.length
  await writeSyncState(scope, { ...(complete ? { offerEventId: newest } : {}), at: { offers: new Date().toISOString() } })
  return `${ids.size} offers to read, ${updated} updated, ${linked} linked, ${failed} not read${complete ? "" : " (tried again next run)"}`
}

/** Price and stock of listed offers after a fresh read of Medusa. */
export async function pushPriceStock(scope: Scope): Promise<string> {
  const settings = await readSettings(scope)
  if (!settings.offerDefaults.syncPriceStock) return "off"
  const client = requireClient(scope)
  const svc = vonHalskySvc(scope)
  const listed = await listedRows(scope, { status: "listed", remote_id: { $ne: null } }, 5000)
  if (listed.length === 0) return "nothing listed"
  await refreshOffers(scope, { variantIds: listed.map((r) => String(r.variant_id)) })
  const rows = await listedRows(scope, { status: "listed", remote_id: { $ne: null } }, 5000)
  const plan = pushPlan(rows)
  const now = new Date()
  const byRow = new Map(rows.map((r) => [r.id, r]))
  if (plan.prices.length) {
    const cmds = await client.updatePrices(plan.prices)
    const byOffer = new Map(cmds.map((c) => [c.offerId, c]))
    await svc.updateVonHalskyOffers(
      plan.prices.map((p) => {
        const c = byOffer.get(p.offerId)
        return { id: p.rowId, pushed_price_minor: p.grossPriceMinor, ...(c ? { command_id: c.commandId, command_kind: "price", command_status: c.status, command_at: now } : {}) }
      }),
    )
  }
  if (plan.stocks.length) {
    const cmds = await client.updateStocks(plan.stocks)
    const byOffer = new Map(cmds.map((c) => [c.offerId, c]))
    await svc.updateVonHalskyOffers(
      plan.stocks.map((p) => {
        const c = byOffer.get(p.offerId)
        return { id: p.rowId, pushed_stock: p.quantity, ...(c ? { command_id: c.commandId, command_kind: "stock", command_status: c.status, command_at: now } : {}) }
      }),
    )
  }
  for (const x of plan.close) {
    const c = await client.closeOffer(x.offerId).catch(() => null)
    if (c) await svc.updateVonHalskyOffers({ id: x.rowId, pushed_stock: 0, command_id: c.commandId, command_kind: "close", command_status: c.status, command_at: now })
  }
  for (const x of plan.reopen) {
    const c = await client.reopenOffer(x.offerId).catch(() => null)
    const r = byRow.get(x.rowId)
    if (c) await svc.updateVonHalskyOffers({ id: x.rowId, pushed_stock: null, command_id: c.commandId, command_kind: "reopen", command_status: c.status, command_at: now, remote_status: r?.remote_status ?? null })
  }
  const total = plan.prices.length + plan.stocks.length + plan.close.length + plan.reopen.length
  if (total > 0) {
    await logSync(scope, {
      area: "offers",
      action: "push",
      message: `Sent ${plan.prices.length} prices and ${plan.stocks.length} stock levels; ${plan.close.length} offers closed at zero stock, ${plan.reopen.length} reopened.`,
      count: total,
      demo: optionsOf(scope).demo,
    })
  }
  return `${plan.prices.length} prices, ${plan.stocks.length} stocks, ${plan.close.length} closed, ${plan.reopen.length} reopened`
}

const DAY = (d: Date) => d.toISOString().slice(0, 10)

/** Today's offer counts, once a day (the history of the statistics). */
export async function takeSnapshot(scope: Scope, force = false): Promise<string> {
  const svc = vonHalskySvc(scope)
  const day = DAY(new Date())
  const [existing] = ((await svc.listVonHalskySnapshots({ day }, { take: 1 })) ?? []) as Row[]
  if (existing && !force) return "already taken"
  const rows: Row[] = []
  for (let skip = 0; ; skip += 1000) {
    const page = ((await svc.listVonHalskyOffers({}, { skip, take: 1000, select: ["id", "status", "remote_status", "stock", "price_minor", "promotion", "program"] })) ?? []) as Row[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  const by = (k: string) => rows.filter((r) => r.remote_status === k).length
  const data = {
    offers: rows.length,
    listed: rows.filter((r) => r.status === "listed").length,
    published: by("PUBLISHED"),
    pending: by("PENDING"),
    rejected: by("REJECTED"),
    soldout: by("SOLDOUT"),
    closed: by("CLOSED"),
    blocked: rows.filter((r) => r.status === "blocked").length,
    promotions: rows.filter((r) => r.promotion).length,
    program: rows.filter((r) => r.program === "IN").length,
    units: rows.filter((r) => r.status === "listed").reduce((s, r) => s + (Number(r.stock) || 0), 0),
    stockValueMinor: rows.filter((r) => r.status === "listed").reduce((s, r) => s + (Number(r.stock) || 0) * (Number(r.price_minor) || 0), 0),
  }
  if (existing) await svc.updateVonHalskySnapshots({ id: existing.id, data })
  else await svc.createVonHalskySnapshots({ day, data, demo: optionsOf(scope).demo })
  return `snapshot of ${day}`
}

/* A run in progress: the job and "Sync now" join it instead of queueing a second one. */
let running: Promise<SyncReport> | null = null

/** Runs the parts (all by default). Never throws: the report says what failed. */
export async function runSync(container: MedusaContainer, parts: readonly SyncPart[] = SYNC_PARTS): Promise<SyncReport> {
  if (!clientOf(container)) return {}
  if (running) return running
  running = runParts(container, parts).finally(() => {
    running = null
  })
  return running
}

async function runParts(container: MedusaContainer, parts: readonly SyncPart[]): Promise<SyncReport> {
  return withLock("sync", async () => {
    const report: SyncReport = {}
    const state = await readSyncState(container)
    const run = async (part: SyncPart, fn: () => Promise<string>) => {
      if (!parts.includes(part)) return
      try {
        report[part] = { ok: true, detail: await fn() }
      } catch (err) {
        const message = errorText(err, container)
        report[part] = { ok: false, detail: message }
        await logSync(container, { area: "sync", action: part, outcome: "error", message, demo: optionsOf(container).demo })
      }
    }
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    await run("categories", async () => {
      const last = state.at.categories ? Date.parse(state.at.categories) : 0
      if (last > weekAgo && parts.length === SYNC_PARTS.length) return "fresh"
      const r = await syncCategories(container)
      await writeSyncState(container, { at: { categories: new Date().toISOString() } })
      return `${r.count} categories`
    })
    await run("commands", () => followCommands(container))
    await run("offers", () => followOffers(container))
    await run("push", () => pushPriceStock(container))
    await run("orders", async () => {
      const r = await importNewOrders(container)
      return `${r.seen} read, ${r.imported} imported, ${r.held} held, ${r.updated} updated`
    })
    await run("cases", async () => {
      const r = await syncCases(container)
      return `${r.returns} returns, ${r.claims} claims, ${r.refunds} refunds, ${r.created} new`
    })
    await run("snapshot", () => takeSnapshot(container))
    await writeSyncState(container, { at: { sync: new Date().toISOString() } })
    return report
  })
}
