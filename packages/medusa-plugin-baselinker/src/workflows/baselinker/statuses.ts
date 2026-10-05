/**
 * THE WAY BACK: status, tracking and the fulfillment of orders already in
 * BaseLinker.
 *
 * Without it the flow is one-way: measured in production, orders shipped
 * from BaseLinker with DPD tracking numbers stayed "not fulfilled" in Medusa
 * and the buyer had no way to know the parcel was on its way.
 *
 * WHAT IS READ. Sent orders of the last 30 days that are not closed (a
 * status in `closedStatusIds` closes an order), oldest check first, 60 per
 * pass. With `customSourceId` the plugin reads its own orders in batches of
 * 100 (`getOrders` filtered by that source); whatever the batch did not
 * return, and every order without a custom source, is read one by one with
 * `getOrders({ order_id })`. Status names come from `getOrderStatusList`,
 * once per run.
 *
 * WHAT IS WRITTEN. The row (status, tracking, carrier), and the order
 * metadata `baselinker_status_id`, `baselinker_status_name`,
 * `baselinker_tracking_number`, `baselinker_tracking_url`,
 * `baselinker_carrier`, so the storefront and the e-mails can show the parcel
 * without a new route. `baselinker.order_status_changed` is emitted on change.
 *
 * FULFILLMENT. When the status is one of `fulfillOnStatusIds`, the Medusa
 * fulfillment is created ONCE for the items still unfulfilled, with
 * `no_notification` (ported from production). It does not take stock twice:
 * the stock pull keeps Medusa stocked at BaseLinker plus reservations, so the
 * fulfillment (stocked minus one, reservation minus one) lands exactly on the
 * BaseLinker number. Measured on the first production order: stocked 1 to 0,
 * reserved 1 to 0, BaseLinker 0.
 */

import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import type { BaseLinkerClient, BaseLinkerOrder } from "../../modules/baselinker/lib/client"
import {
  FULFILLMENTS_PER_PASS,
  ORDER_METADATA,
  ORDERS_PAGE_SIZE,
  PLUGIN_EVENTS,
  STATUS_BATCH_MAX_PAGES,
  STATUS_WINDOW_DAYS,
  STATUSES_PER_PASS,
} from "../../modules/baselinker/lib/constants"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { DEMO_STATUSES, demoOrder } from "../../modules/baselinker/lib/demo"
import type { OrderRow } from "../../modules/baselinker/lib/dto"
import { describeError } from "../../modules/baselinker/lib/errors"
import { toNumber, toNumberOrNull } from "../../modules/baselinker/lib/numbers"
import { canReadStatuses } from "../../modules/baselinker/lib/options"
import { carrierName, trackingUrl } from "../../modules/baselinker/lib/tracking"
import { baselinkerService, clientFor, emitEvent, exclusive, patchOrderMetadata, queryOf, recordRun, type Scope } from "./runtime"

export interface StatusesStats {
  candidates: number
  read: number
  changed: number
  withTracking: number
  notFound: number
  notFoundSample: string[]
  errors: string[]
  fulfilled: number
  fulfillSkipped: number
  fulfillErrors: string[]
}

function emptyStats(): StatusesStats {
  return { candidates: 0, read: 0, changed: 0, withTracking: 0, notFound: 0, notFoundSample: [], errors: [], fulfilled: 0, fulfillSkipped: 0, fulfillErrors: [] }
}

function ms(v: Date | string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function label(row: OrderRow): string {
  return `#${row.display_id ?? row.order_id}`
}

async function updateRow(svc: BaseLinkerModuleService, id: string, patch: Record<string, unknown>): Promise<void> {
  await svc.updateBaseLinkerOrders({ id, ...patch } as never)
}

/** Live orders: batched by our own source where possible, one by one for the rest. */
async function fetchOrders(
  svc: BaseLinkerModuleService,
  client: BaseLinkerClient,
  candidates: OrderRow[],
  stats: StatusesStats,
): Promise<Map<string, BaseLinkerOrder>> {
  const o = svc.getOptions()
  const found = new Map<string, BaseLinkerOrder>()
  const wanted = new Set(candidates.map((c) => String(c.bl_order_id)))

  if (o.customSourceId !== null && candidates.length > 1) {
    try {
      const ids = candidates.map((c) => Number(c.bl_order_id)).filter((n) => Number.isFinite(n) && n > 0)
      const earliest = Math.min(...candidates.map((c) => ms(c.created_at) || Date.now()))
      let idFrom = Math.min(...ids)
      for (let page = 1; page <= STATUS_BATCH_MAX_PAGES; page += 1) {
        const orders = await client.getOrders({
          id_from: idFrom,
          date_from: Math.max(0, Math.floor(earliest / 1000) - 86_400),
          get_unconfirmed_orders: true,
          filter_order_source: "personal",
          filter_order_source_id: o.customSourceId,
        })
        for (const order of orders) {
          const id = String(order.order_id)
          if (wanted.has(id)) found.set(id, order)
        }
        if (orders.length < ORDERS_PAGE_SIZE || found.size === wanted.size) break
        const highest = Math.max(...orders.map((x) => Number(x.order_id) || 0))
        if (!(highest > 0)) break
        idFrom = highest + 1
      }
    } catch (err) {
      stats.errors.push(`batch read: ${svc.mask(describeError(err).message)}`)
    }
  }

  for (const row of candidates) {
    const id = String(row.bl_order_id)
    if (found.has(id)) continue
    try {
      const orders = await client.getOrders({ order_id: Number(id), get_unconfirmed_orders: true })
      const order = orders.find((x) => String(x.order_id) === id)
      if (order) found.set(id, order)
    } catch (err) {
      const d = describeError(err)
      if (stats.errors.length < 10) stats.errors.push(`${label(row)}: ${svc.mask(d.message)}`)
      /* BaseLinker is not answering: the rest would only wait for the same timeout. */
      if (d.code === "ERROR_NETWORK" || d.code.startsWith("HTTP_5")) break
    }
  }
  return found
}

/** Creates the Medusa fulfillment for the remaining items, once. Never throws. */
async function fulfill(scope: Scope, row: OrderRow, stats: StatusesStats): Promise<void> {
  const svc = baselinkerService(scope)
  const o = svc.getOptions()
  const now = new Date()
  try {
    const { data } = await queryOf(scope).graph({
      entity: "order",
      fields: ["id", "status", "items.*", "items.detail.*"],
      filters: { id: row.order_id },
    })
    const order = data[0] as
      | { status?: string; items?: Array<{ id: string; quantity?: unknown; detail?: { quantity?: unknown; fulfilled_quantity?: unknown } | null }> | null }
      | undefined
    if (!order || order.status === "canceled") {
      await updateRow(svc, row.id, {
        fulfilled_at: now,
        last_error: order ? "Not fulfilled: the order is canceled in Medusa." : "Not fulfilled: the order no longer exists in Medusa.",
        last_error_code: "fulfillment_skipped",
      })
      stats.fulfillSkipped += 1
      return
    }
    const items = (order.items ?? [])
      .map((i) => ({ id: i.id, quantity: Math.round(toNumber(i.detail?.quantity ?? i.quantity) - toNumber(i.detail?.fulfilled_quantity)) }))
      .filter((i) => i.quantity > 0)
    if (items.length === 0) {
      /* A person fulfilled it already: nothing left, the closing is done. */
      await updateRow(svc, row.id, { fulfilled_at: now })
      stats.fulfillSkipped += 1
      return
    }
    await createOrderFulfillmentWorkflow(scope as never).run({
      input: {
        order_id: row.order_id,
        items,
        no_notification: true,
        ...(o.stockLocationId ? { location_id: o.stockLocationId } : {}),
        metadata: { source: "baselinker", baselinker_order_id: row.bl_order_id, baselinker_status_id: row.bl_status_id },
      },
    })
    await updateRow(svc, row.id, { fulfilled_at: new Date(), last_error: null, last_error_code: null })
    stats.fulfilled += 1
    svc.getLogger().info(`[baselinker] ${label(row)}: fulfilled after BaseLinker status ${row.bl_status_name ?? row.bl_status_id} (${items.length} line(s))`)
  } catch (err) {
    const message = svc.mask((err as Error)?.message ?? String(err)).slice(0, 1000)
    await updateRow(svc, row.id, { last_error: `Fulfillment: ${message}`, last_error_code: "fulfillment_failed" }).catch(() => undefined)
    if (stats.fulfillErrors.length < 10) stats.fulfillErrors.push(`${label(row)}: ${message}`)
    svc.getLogger().warn(`[baselinker] ${label(row)}: could not create the fulfillment: ${message}`)
  }
}

/** A failed fulfillment is tried again after an hour, not every pass. */
const FULFILL_RETRY_MS = 60 * 60 * 1000

/**
 * Reads status and tracking of sent orders and creates fulfillments.
 * `onlyOrderIds` limits the read to Medusa orders (the order widget in demo
 * mode), `onlyBlIds` to BaseLinker orders (the ones the journal named).
 * Returns null when a read already runs in this process.
 */
export async function syncStatuses(scope: Scope, trigger: RunTrigger, onlyOrderIds?: string[], onlyBlIds?: string[]): Promise<StatusesStats | null> {
  return exclusive("statuses", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const stats = emptyStats()
    if (!canReadStatuses(o)) return stats

    const startedAt = new Date()
    const now = new Date()
    const since = new Date(now.getTime() - STATUS_WINDOW_DAYS * 24 * 3600 * 1000)
    const filters: Record<string, unknown> = { status: "sent", demo: o.demo, sent_at: { $gte: since } }
    if (onlyOrderIds && onlyOrderIds.length > 0) filters.order_id = onlyOrderIds
    if (onlyBlIds) filters.bl_order_id = onlyBlIds
    const rows = (await svc.listBaseLinkerOrders(filters as never, { take: null } as never)) as unknown as OrderRow[]
    const candidates = rows
      .filter((r) => r.bl_order_id && !(r.bl_status_id !== null && o.closedStatusIds.includes(r.bl_status_id)))
      .sort((a, b) => ms(a.status_checked_at) - ms(b.status_checked_at))
      .slice(0, STATUSES_PER_PASS)
    stats.candidates = candidates.length

    if (candidates.length > 0) {
      let names = new Map<number, string>()
      let found = new Map<string, BaseLinkerOrder>()
      if (o.demo) {
        names = new Map(DEMO_STATUSES.map((s) => [s.id, s.name]))
        for (const r of candidates) {
          const sentAt = new Date(r.sent_at ?? r.created_at ?? now)
          found.set(String(r.bl_order_id), demoOrder({ blOrderId: String(r.bl_order_id), orderId: r.order_id, sentAt, now }) as BaseLinkerOrder)
        }
      } else {
        const client = clientFor(svc)
        try {
          names = await client.getOrderStatusList()
        } catch (err) {
          stats.errors.push(`getOrderStatusList: ${svc.mask(describeError(err).message)}`)
        }
        found = await fetchOrders(svc, client, candidates, stats)
      }

      for (const row of candidates) {
        const order = found.get(String(row.bl_order_id))
        if (!order) {
          stats.notFound += 1
          if (stats.notFoundSample.length < 20) stats.notFoundSample.push(`${label(row)} (BaseLinker ${row.bl_order_id})`)
          await updateRow(svc, row.id, { status_checked_at: now })
          continue
        }
        stats.read += 1
        const statusId = toNumberOrNull(order.order_status_id)
        const number = text(order.delivery_package_nr)
        const module = text(order.delivery_package_module)
        const name = statusId !== null ? names.get(statusId) ?? (statusId === row.bl_status_id ? row.bl_status_name : null) : null
        const url = trackingUrl(module, number)
        const carrier = carrierName(module)
        if (number) stats.withTracking += 1

        const statusChanged = statusId !== (row.bl_status_id ?? null)
        const trackingChanged = number !== (row.tracking_number ?? null) || carrier !== (row.carrier ?? null)
        const nameChanged = name !== (row.bl_status_name ?? null)
        await updateRow(svc, row.id, {
          bl_status_id: statusId,
          bl_status_name: name,
          tracking_number: number,
          tracking_url: url,
          carrier,
          status_checked_at: now,
        })
        if (!statusChanged && !trackingChanged && !nameChanged) continue
        stats.changed += 1
        try {
          await patchOrderMetadata(scope, row.order_id, {
            [ORDER_METADATA.statusId]: statusId,
            [ORDER_METADATA.statusName]: name,
            [ORDER_METADATA.trackingNumber]: number,
            [ORDER_METADATA.trackingUrl]: url,
            [ORDER_METADATA.carrier]: carrier,
          })
        } catch (err) {
          if (stats.errors.length < 10) stats.errors.push(`${label(row)} metadata: ${svc.mask((err as Error)?.message ?? String(err))}`)
        }
        if (statusChanged || trackingChanged) {
          await emitEvent(scope, PLUGIN_EVENTS.orderStatusChanged, {
            order_id: row.order_id,
            display_id: row.display_id,
            baselinker_order_id: row.bl_order_id,
            status_id: statusId,
            status_name: name,
            previous_status_id: row.bl_status_id ?? null,
            tracking_number: number,
            tracking_url: url,
            carrier,
            demo: o.demo,
          })
        }
      }
    }

    /* Fulfillments: every sent order whose stored status is a closing one
     * and that has none yet, including the backlog from before the option
     * was set. Never in demo mode: a fulfillment moves real stock. */
    if (o.fulfillOnStatusIds.length > 0 && !o.demo) {
      const due = (await svc.listBaseLinkerOrders(
        { status: "sent", demo: false, fulfilled_at: null, bl_status_id: o.fulfillOnStatusIds, sent_at: { $gte: since } } as never,
        { take: FULFILLMENTS_PER_PASS * 5, order: { status_checked_at: "DESC" } } as never,
      )) as unknown as OrderRow[]
      const ready = due
        .filter((r) => r.last_error_code !== "fulfillment_failed" || now.getTime() - ms(r.updated_at) > FULFILL_RETRY_MS)
        .slice(0, FULFILLMENTS_PER_PASS)
      for (const row of ready) await fulfill(scope, row, stats)
    }

    /* Quiet when nothing happened: a status read every 15 minutes would
     * otherwise bury the history in empty runs. */
    const worthARun = stats.changed > 0 || stats.fulfilled > 0 || stats.fulfillErrors.length > 0 || stats.errors.length > 0 || trigger === "manual"
    if (worthARun) {
      const failedAll = stats.candidates > 0 && stats.read === 0 && stats.errors.length > 0
      await recordRun(svc, {
        kind: "statuses",
        trigger,
        status: failedAll ? "error" : stats.errors.length > 0 || stats.fulfillErrors.length > 0 ? "partial" : "ok",
        complete: stats.errors.length === 0,
        startedAt,
        counts: { ...stats },
        message:
          stats.errors.length > 0
            ? stats.errors.slice(0, 3).join("; ")
            : `${stats.read} read, ${stats.changed} changed, ${stats.withTracking} with tracking, ${stats.fulfilled} fulfilled.`,
      })
    }
    return stats
  })
}

/* ------------------------------------------------------------------ */
/* Demo: let the simulated warehouse move while someone watches        */
/* ------------------------------------------------------------------ */

const DEMO_REFRESH_KEY = Symbol.for("koda.baselinker.demoRefresh")
const DEMO_REFRESH_MS = 20_000

/**
 * Demo mode only: reads the simulated statuses again when the admin looks at
 * orders, at most every 20 seconds per process. In-process and cheap, so an
 * evaluator sees an order move from "Nowe" to "Wysłane" without waiting for
 * the 15 minute job.
 */
export async function refreshDemoStatuses(scope: Scope): Promise<void> {
  const svc = baselinkerService(scope)
  if (!svc.isDemo()) return
  const holder = globalThis as typeof globalThis & { [DEMO_REFRESH_KEY]?: number }
  const last = holder[DEMO_REFRESH_KEY] ?? 0
  if (Date.now() - last < DEMO_REFRESH_MS) return
  holder[DEMO_REFRESH_KEY] = Date.now()
  await syncStatuses(scope, "auto").catch(() => null)
}
