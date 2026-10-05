/**
 * THE ORDER OUTBOX: Medusa orders to BaseLinker, exactly once.
 *
 * ORDER OF OPERATIONS IS THE WHOLE MECHANISM:
 *   1. `order.placed` writes a row FIRST (cheap, local, cannot fail on
 *      BaseLinker), then the send is attempted in the background;
 *   2. every attempt pushes its own next attempt ten minutes ahead before it
 *      touches the network (a process that dies mid-send leaves a row that
 *      comes back by itself);
 *   3. the payload is built from the order at send time (it is never stored:
 *      it carries personal data);
 *   4. `createOrderOnce` scans BaseLinker for the order marker, adopts an
 *      order that is already there, otherwise sends ONE `addOrder`;
 *   5. success writes `sent`, the BaseLinker id and the order metadata;
 *      failure schedules a retry with backoff, then `failed` for a person.
 *
 * A row with a BaseLinker id never goes out again by any road: the drain,
 * the "Send again" button and the workflow all stop at it.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { planRetry } from "../../modules/baselinker/lib/backoff"
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  ORDER_METADATA,
  ORDERS_PER_PASS,
  PLUGIN_EVENTS,
  SEND_LEASE_MS,
} from "../../modules/baselinker/lib/constants"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { DEMO_INVENTORY_ID, DEMO_STATUSES, nextDemoOrderId } from "../../modules/baselinker/lib/demo"
import type { OrderRow } from "../../modules/baselinker/lib/dto"
import { describeError } from "../../modules/baselinker/lib/errors"
import { findOrderByMarker } from "../../modules/baselinker/lib/exactly-once"
import { canExportOrders } from "../../modules/baselinker/lib/options"
import {
  ORDER_FIELDS,
  PayloadError,
  buildAddOrderPayload,
  isSkipped,
  orderMarker,
  type OrderRecord,
} from "../../modules/baselinker/lib/order-payload"
import {
  baselinkerService,
  clientFor,
  emitEvent,
  exclusive,
  patchOrderMetadata,
  queryOf,
  recordRun,
  withOrderLock,
  type Scope,
} from "./runtime"

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export async function findOrderRow(svc: BaseLinkerModuleService, orderId: string): Promise<OrderRow | null> {
  const rows = (await svc.listBaseLinkerOrders({ order_id: orderId, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as OrderRow[]
  return rows[0] ?? null
}

async function updateRow(svc: BaseLinkerModuleService, id: string, patch: Record<string, unknown>): Promise<OrderRow> {
  return (await svc.updateBaseLinkerOrders({ id, ...patch } as never)) as unknown as OrderRow
}

export async function loadOrder(scope: Scope, orderId: string): Promise<OrderRecord | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: [...ORDER_FIELDS], filters: { id: orderId } })
  return (data[0] as OrderRecord | undefined) ?? null
}

interface OrderHead {
  id: string
  display_id?: number | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

export async function loadOrderHead(scope: Scope, orderId: string): Promise<OrderHead | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "display_id", "status", "metadata"], filters: { id: orderId } })
  return (data[0] as OrderHead | undefined) ?? null
}

export interface EnqueueInput {
  orderId: string
  displayId?: number | null
  /** A person asked: a failed or waiting row goes back to the queue, attempts reset. */
  force?: boolean
  /** Why the order does not go, recorded as a `skipped` row. */
  skipReason?: string | null
}

/**
 * Creates the outbox row of an order or moves it forward. Safe to call twice
 * for the same event; a `sent` row is never touched.
 */
export async function enqueueOrder(scope: Scope, input: EnqueueInput): Promise<OrderRow> {
  const svc = baselinkerService(scope)
  const now = new Date()
  let row = await findOrderRow(svc, input.orderId)
  if (!row) {
    try {
      return (await svc.createBaseLinkerOrders({
        order_id: input.orderId,
        display_id: input.displayId ?? null,
        status: input.skipReason ? "skipped" : "pending",
        attempts: 0,
        next_attempt_at: input.skipReason ? null : now,
        last_error: input.skipReason ?? null,
        last_error_code: input.skipReason ? "skipped" : null,
        demo: svc.isDemo(),
      } as never)) as unknown as OrderRow
    } catch {
      /* Two subscribers raced for the same order; the unique index kept one row. */
      row = await findOrderRow(svc, input.orderId)
      if (!row) throw new Error(`Could not queue order ${input.orderId} for BaseLinker.`)
    }
  }
  if (row.status === "sent" || row.bl_order_id) return row
  if (input.force) {
    return updateRow(svc, row.id, {
      status: "pending",
      attempts: 0,
      next_attempt_at: now,
      last_error: null,
      last_error_code: null,
      display_id: input.displayId ?? row.display_id,
    })
  }
  return row
}

/* ------------------------------------------------------------------ */
/* One attempt                                                         */
/* ------------------------------------------------------------------ */

export interface SendOutcome {
  status: "sent" | "retry" | "failed" | "skipped" | "busy"
  orderId: string
  blOrderId: string | null
  adopted: boolean
  code: string | null
  message: string | null
}

/** Variant id to BaseLinker card id, from the snapshot of the current mode. */
async function linksFor(svc: BaseLinkerModuleService, order: OrderRecord): Promise<Map<string, string>> {
  const ids = [...new Set((order.items ?? []).map((i) => i.variant_id ?? i.variant?.id).filter((v): v is string => Boolean(v)))]
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = (await svc.listBaseLinkerProducts({ variant_id: ids, demo: svc.isDemo() } as never, {
    take: ids.length * 2,
    select: ["variant_id", "bl_product_id", "conflict"],
  } as never)) as unknown as Array<{ variant_id: string; bl_product_id: string; conflict: string | null }>
  for (const r of rows) if (r.variant_id && !r.conflict) out.set(r.variant_id, r.bl_product_id)
  return out
}

/** The simulated BaseLinker: an id in milliseconds, the next one after the highest given out. */
async function demoCreate(svc: BaseLinkerModuleService): Promise<string> {
  const rows = (await svc.listBaseLinkerOrders({ demo: true, bl_order_id: { $ne: null } } as never, {
    take: null,
    select: ["bl_order_id"],
  } as never)) as unknown as Array<{ bl_order_id: string | null }>
  const highest = rows.reduce((max, r) => Math.max(max, Number(r.bl_order_id) || 0), 0)
  return String(nextDemoOrderId(highest || null))
}

async function markSkipped(svc: BaseLinkerModuleService, row: OrderRow, reason: string): Promise<SendOutcome> {
  await updateRow(svc, row.id, { status: "skipped", next_attempt_at: null, last_error: reason, last_error_code: "skipped" })
  return { status: "skipped", orderId: row.order_id, blOrderId: null, adopted: false, code: "skipped", message: reason }
}

/**
 * An order that must not go out (canceled, or marked as a test order) after an
 * earlier attempt: that attempt may have created it in BaseLinker without an
 * answer. Scan first, so a BaseLinker order is never hidden behind "skipped".
 */
async function stopOrAdopt(scope: Scope, row: OrderRow, order: OrderRecord, reason: string): Promise<SendOutcome> {
  const svc = baselinkerService(scope)
  if ((row.attempts ?? 0) > 0 && !svc.isDemo()) {
    const placedAt = Math.floor(new Date(order.created_at ?? Date.now()).getTime() / 1000)
    const client = clientFor(svc)
    const found = await findOrderByMarker((params) => client.getOrders(params), orderMarker(order.id), placedAt)
    if (found) {
      const note = `${reason} It had already reached BaseLinker as ${found}: handle it there.`
      await updateRow(svc, row.id, {
        status: "sent",
        bl_order_id: found,
        sent_at: new Date(),
        next_attempt_at: null,
        last_error: note,
        last_error_code: "stopped_after_send",
      })
      await patchOrderMetadata(scope, row.order_id, { [ORDER_METADATA.orderId]: found }).catch(() => false)
      return { status: "sent", orderId: row.order_id, blOrderId: found, adopted: true, code: "stopped_after_send", message: note }
    }
  }
  return markSkipped(svc, row, reason)
}

/** One attempt of one row. Every BaseLinker failure lands in the row. Call it holding the order lock. */
async function attempt(scope: Scope, row: OrderRow): Promise<SendOutcome> {
  const svc = baselinkerService(scope)
  const o = svc.getOptions()
  const attempts = (row.attempts ?? 0) + 1
  await updateRow(svc, row.id, { attempts, next_attempt_at: new Date(Date.now() + SEND_LEASE_MS) })
  const label = `#${row.display_id ?? row.order_id}`

  try {
    const order = await loadOrder(scope, row.order_id)
    if (!order) throw new PayloadError("order_not_found", `Order ${row.order_id} does not exist in Medusa.`)
    if (order.status === "canceled") return await stopOrAdopt(scope, row, order, "The order was canceled in Medusa.")
    if (isSkipped(order.metadata, o.skipOrderMetadataKey)) {
      return await stopOrAdopt(scope, row, order, `order.metadata.${o.skipOrderMetadataKey} is true, so the order stays out of BaseLinker.`)
    }
    if (!o.demo && o.orderStatusId === null) throw new PayloadError("not_configured", "orderStatusId is not set in the plugin options.")

    const links = await linksFor(svc, order)
    const built = buildAddOrderPayload(order, links, {
      orderStatusId: o.orderStatusId ?? DEMO_STATUSES[0].id,
      customSourceId: o.customSourceId,
      inventoryId: o.demo ? DEMO_INVENTORY_ID : o.inventoryId,
      codProviders: o.codProviders,
      paymentLabels: o.paymentLabels,
    })
    const placedAt = Math.floor(new Date(order.created_at ?? Date.now()).getTime() / 1000)

    let blOrderId: string
    let adopted = false
    if (o.demo) {
      /* Nothing leaves Medusa: the payload was built (so bad order data fails
       * like it would live), the id comes from the simulated account. */
      blOrderId = row.bl_order_id ?? (await demoCreate(svc))
    } else {
      const res = await clientFor(svc).createOrderOnce(built.payload, built.marker, placedAt)
      blOrderId = res.blOrderId
      adopted = res.adopted
    }

    const displayId = typeof order.display_id === "number" ? order.display_id : row.display_id
    await updateRow(svc, row.id, {
      status: "sent",
      bl_order_id: blOrderId,
      sent_at: new Date(),
      next_attempt_at: null,
      last_error: null,
      last_error_code: null,
      display_id: displayId,
    })
    try {
      await patchOrderMetadata(scope, row.order_id, { [ORDER_METADATA.orderId]: blOrderId })
    } catch (err) {
      svc.getLogger().warn(`[baselinker] ${label}: sent as ${blOrderId}, but the order metadata was not written: ${svc.mask((err as Error)?.message ?? String(err))}`)
    }
    await emitEvent(scope, PLUGIN_EVENTS.orderSent, {
      order_id: row.order_id,
      display_id: displayId,
      baselinker_order_id: blOrderId,
      adopted,
      linked_lines: built.linked,
      free_lines: built.unlinked.length,
      demo: o.demo,
    })
    svc
      .getLogger()
      .info(`[baselinker] ${label} ${adopted ? "was already in BaseLinker as" : "sent as"} ${blOrderId} (${built.linked} linked, ${built.unlinked.length} free line(s))`)
    return { status: "sent", orderId: row.order_id, blOrderId, adopted, code: null, message: null }
  } catch (err) {
    const d = describeError(err)
    const plan = planRetry({ attempts, retryable: d.retryable, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now: new Date() })
    const message = svc.mask(d.message).slice(0, 2000)
    await updateRow(svc, row.id, { status: plan.status, next_attempt_at: plan.nextAttemptAt, last_error: message, last_error_code: d.code })
    if (plan.status === "failed") {
      svc.getLogger().warn(`[baselinker] ${label} failed after ${attempts} attempt(s): [${d.code}] ${message}`)
      await emitEvent(scope, PLUGIN_EVENTS.orderFailed, {
        order_id: row.order_id,
        display_id: row.display_id,
        code: d.code,
        message,
        attempts,
        demo: o.demo,
      })
      return { status: "failed", orderId: row.order_id, blOrderId: null, adopted: false, code: d.code, message }
    }
    svc.getLogger().info(`[baselinker] ${label}: attempt ${attempts} failed [${d.code}], next at ${plan.nextAttemptAt?.toISOString()}`)
    return { status: "retry", orderId: row.order_id, blOrderId: null, adopted: false, code: d.code, message }
  }
}

/**
 * Sends one order now: creates its row when missing, holds the order lock,
 * stops at a row that is already in BaseLinker. Used by the outbox, the
 * admin and `sendOrderToBaseLinkerWorkflow`.
 */
export async function sendOrderNow(scope: Scope, orderId: string, options: { force?: boolean } = {}): Promise<SendOutcome> {
  const svc = baselinkerService(scope)
  const busy: SendOutcome = { status: "busy", orderId, blOrderId: null, adopted: false, code: "busy", message: "The order is being sent right now." }
  const result = await withOrderLock(scope, orderId, async (): Promise<SendOutcome> => {
    let row = await findOrderRow(svc, orderId)
    if (!row || options.force) {
      const head = await loadOrderHead(scope, orderId)
      if (!head) {
        return { status: "failed", orderId, blOrderId: null, adopted: false, code: "order_not_found", message: `Order ${orderId} does not exist.` }
      }
      row = await enqueueOrder(scope, { orderId, displayId: head.display_id ?? null, force: options.force })
    }
    if (row.status === "sent" || row.bl_order_id) {
      return { status: "sent", orderId, blOrderId: row.bl_order_id, adopted: true, code: null, message: null }
    }
    if (row.status === "skipped" && !options.force) {
      return { status: "skipped", orderId, blOrderId: null, adopted: false, code: "skipped", message: row.last_error }
    }
    return attempt(scope, row)
  })
  return result ?? busy
}

/* ------------------------------------------------------------------ */
/* The pass over due rows                                              */
/* ------------------------------------------------------------------ */

export interface OrdersPassStats {
  processed: number
  sent: number
  adopted: number
  retry: number
  failed: number
  skipped: number
  busy: number
}

/** Codes meaning "BaseLinker is not reachable", not "this order is wrong": the rest of the pass would only wait for the same timeout. */
const CONNECTIVITY = new Set(["ERROR_NETWORK", "HTTP_502", "HTTP_503", "HTTP_504", "unknown_result"])

/** Sends the due rows, oldest first. One pass per process at a time; null when a pass already runs. */
export async function sendDueOrders(scope: Scope, trigger: RunTrigger): Promise<OrdersPassStats | null> {
  return exclusive("orders", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const stats: OrdersPassStats = { processed: 0, sent: 0, adopted: 0, retry: 0, failed: 0, skipped: 0, busy: 0 }
    if (!canExportOrders(o)) return stats

    const now = new Date()
    const due = (await svc.listBaseLinkerOrders({ status: "pending", demo: o.demo, next_attempt_at: { $lte: now } } as never, {
      take: ORDERS_PER_PASS,
      order: { next_attempt_at: "ASC", created_at: "ASC" },
    } as never)) as unknown as OrderRow[]
    if (due.length === 0) return stats

    const startedAt = new Date()
    for (const row of due) {
      const outcome = await sendOrderNow(scope, row.order_id)
      stats.processed += 1
      if (outcome.status === "sent") {
        stats.sent += 1
        if (outcome.adopted) stats.adopted += 1
      } else if (outcome.status === "retry") stats.retry += 1
      else if (outcome.status === "failed") stats.failed += 1
      else if (outcome.status === "skipped") stats.skipped += 1
      else stats.busy += 1
      if (outcome.status === "retry" && outcome.code && CONNECTIVITY.has(outcome.code)) break
    }

    await recordRun(svc, {
      kind: "orders",
      trigger,
      status: stats.failed > 0 || stats.retry > 0 ? "partial" : "ok",
      complete: true,
      startedAt,
      counts: { ...stats },
      message:
        stats.retry > 0 || stats.failed > 0
          ? `${stats.sent} sent, ${stats.retry} to retry, ${stats.failed} need attention.`
          : `${stats.sent} sent${stats.skipped > 0 ? `, ${stats.skipped} skipped` : ""}.`,
    })
    return stats
  })
}

/**
 * Starts a pass in the background (the subscriber, admin actions). When a
 * pass already runs, it may have listed the due rows before this one was
 * written, so the kick tries again a few seconds later, up to three times.
 */
export function kickOrders(scope: Scope, trigger: RunTrigger, tries = 3): void {
  setImmediate(() => {
    sendDueOrders(scope, trigger)
      .then((stats) => {
        if (stats === null && tries > 1) setTimeout(() => kickOrders(scope, trigger, tries - 1), 5000).unref?.()
      })
      .catch((err: unknown) => {
        const svc = baselinkerService(scope)
        svc.getLogger().error(`[baselinker] order pass failed: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
  })
}
