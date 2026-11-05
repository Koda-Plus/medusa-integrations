import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { fromMinor } from "../../modules/inpostpay/lib/confirm"
import { PAYMENT_STATUSES, PAYMENT_TYPES } from "../../modules/inpostpay/lib/constants"
import { parseInpostOrder } from "../../modules/inpostpay/lib/order-input"
import { inpostPaySvc, withEvent } from "../../modules/inpostpay/lib/store"
import { basketRow, updateRow } from "./baskets"
import { placeOrder, type PlaceResult } from "./checkout"
import { annotatePayments, capturePaid, eventIsNew } from "./payments"
import { clientOf, loggerOf, optionsOf, withBasketLock } from "./runtime"

export { parseInpostOrder }

/**
 * THE ORDER SIDE: the order InPost creates (`POST /v1/izi/order`), the order
 * details and events InPost asks for or sends, and the events the store
 * sends back to the Basket App when an order is canceled or shipped.
 */

const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "")

async function displayIdOf(scope: MedusaContainer, orderId: string): Promise<number | null> {
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "order", fields: ["id", "display_id"], filters: { id: orderId } })
    const n = Number((data as any[])[0]?.display_id)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * The order as the Merchant API answers InPost (creation and details). The
 * response schema of those two pages could not be read in full; this shape
 * carries the fields the readable pages name.
 */
export async function orderDetails(scope: MedusaContainer, row: Record<string, any>): Promise<Record<string, unknown>> {
  const displayId = row.order_id ? await displayIdOf(scope, String(row.order_id)) : null
  return {
    order_details: {
      order_id: row.order_id,
      customer_order_id: displayId !== null ? String(displayId) : row.order_id,
      basket_id: row.id,
      order_creation_date: row.ordered_at ? new Date(row.ordered_at).toISOString() : null,
      order_update_date: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      order_status: row.order_status ?? "ORDER_PROCESSING",
      payment_status: row.payment_status ?? null,
      payment_type: row.payment_type ?? null,
      currency: "PLN",
      basket_price: row.amount_minor !== null && row.amount_minor !== undefined ? { gross: Number(fromMinor(row.amount_minor)) } : undefined,
    },
    delivery: { delivery_type: row.delivery_type ?? null, delivery_point: row.delivery_point ?? null },
  }
}

/** POST /v1/izi/order: InPost hands the order over. Idempotent per basket. */
export async function createOrderFromInpost(scope: MedusaContainer, body: Record<string, any>): Promise<{ row: Record<string, any>; result: PlaceResult }> {
  const parsed = parseInpostOrder(body)
  const result = await placeOrder(scope, { ...parsed, source: "inpost" })
  const row = await basketRow(scope, parsed.basketId)
  return { row: row!, result }
}

/** The basket row of an order id (Medusa's), or null. */
export async function basketOfOrder(scope: MedusaContainer, orderId: string): Promise<Record<string, any> | null> {
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)) return null
  const rows = (await inpostPaySvc(scope).listInpostPayBaskets({ order_id: orderId }, { take: 1 })) ?? []
  return rows[0] ?? null
}

/**
 * POST /v1/izi/order/{id}/event from InPost: the payment or order status
 * changed in the app. A repeated event (same `event_id`) or one older than
 * the newest applied (`event_data_time`) is noted and changes nothing. The
 * status and InPost's payment reference also go into the Medusa payment's
 * data (a refund finds the transaction by them); AUTHORIZED captures the
 * payment (`autoCapture`). A failed capture is noted, the event still stands.
 * One event of a basket at a time, on the row as it is then: a resent copy
 * waits and is seen as repeated, so the payment is captured once.
 */
export async function applyInpostOrderEvent(scope: MedusaContainer, row: Record<string, any>, body: Record<string, any>): Promise<Record<string, any>> {
  return withBasketLock(String(row.id), async () => applyEvent(scope, (await basketRow(scope, String(row.id))) ?? row, body))
}

async function applyEvent(scope: MedusaContainer, row: Record<string, any>, body: Record<string, any>): Promise<Record<string, any>> {
  const data = body.event_data ?? {}
  const payment = (PAYMENT_STATUSES as readonly string[]).includes(data.payment_status) ? String(data.payment_status) : null
  const order = data.order_status === "ORDER_REJECTED" || data.order_status === "ORDER_COMPLETED" || data.order_status === "ORDER_PROCESSING" ? String(data.order_status) : null
  const type = (PAYMENT_TYPES as readonly string[]).includes(data.payment_type) ? String(data.payment_type) : null
  const parts = [payment ? `payment ${payment}` : "", order ? `order ${order}` : "", type ? `by ${type}` : ""].filter(Boolean)
  const eventId = text(body.event_id, 80)
  const parsedTime = Date.parse(text(body.event_data_time, 40))
  const eventTime = Number.isFinite(parsedTime) ? parsedTime : null
  const reference = text(data.payment_reference, 120)

  const fresh = eventIsNew(row.events, eventId, eventTime)
  if (!fresh.ok) {
    const why = fresh.reason === "duplicate" ? "a repeated event" : "older than the last one applied"
    return updateRow(scope, row.id, { events: withEvent(row.events, { kind: "note", message: `InPost: ${parts.join(", ") || "an event"} ignored (${why})`, data: { event_id: eventId } }) })
  }

  let events = withEvent(row.events, {
    kind: "payment",
    message: `InPost: ${parts.join(", ") || "an event without a status"}`,
    data: { event_id: eventId, event_time: eventTime !== null ? new Date(eventTime).toISOString() : undefined, payment_reference: reference || undefined },
  })
  const orderId = typeof row.order_id === "string" ? row.order_id : ""
  if (orderId && (payment || type || reference)) {
    const patch: Record<string, unknown> = { order_id: orderId }
    if (payment) patch.inpost_payment_status = payment
    if (type) patch.inpost_payment_type = type
    if (reference) patch.payment_reference = reference
    await annotatePayments(scope, orderId, patch).catch((e: unknown) => loggerOf(scope).warn(`[inpostpay] The payment of ${orderId} was not updated: ${(e as Error)?.message ?? e}`))
  }
  if (orderId && payment === "AUTHORIZED" && optionsOf(scope).autoCapture) {
    try {
      const n = await capturePaid(scope, orderId)
      if (n > 0) events = withEvent(events, { kind: "note", message: "Payment captured in Medusa (InPost reported AUTHORIZED)" })
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 200)
      loggerOf(scope).warn(`[inpostpay] Capturing the payment of ${orderId} failed: ${message}`)
      events = withEvent(events, { kind: "failed", message: `The payment was not captured in Medusa: ${message}. Capture it on the order.` })
    }
  }
  return updateRow(scope, row.id, {
    ...(payment ? { payment_status: payment } : {}),
    ...(order ? { order_status: order } : {}),
    ...(type ? { payment_type: type } : {}),
    events,
  })
}

/**
 * WRITER: tell InPost the store canceled the order (ORDER_REJECTED) or
 * shipped it (the parcel numbers). Only with `sendOrderEvents`; demo mode
 * records a simulated event; never throws (the order flow must not fail).
 */
export async function notifyInpost(scope: MedusaContainer, orderId: string, event: { kind: "canceled" } | { kind: "shipped"; references: string[] }): Promise<void> {
  const o = optionsOf(scope)
  if (!o.sendOrderEvents && !o.demo) return
  const row = await basketOfOrder(scope, orderId).catch(() => null)
  if (!row) return
  const client = clientOf(scope)
  if (!client) return
  const payload = {
    event_id: randomUUID(),
    event_data_time: new Date().toISOString(),
    event_data:
      event.kind === "canceled"
        ? { order_status: "ORDER_REJECTED" as const, order_merchant_status_description: "Zamówienie anulowane przez sklep" }
        : { delivery_references_list: event.references.slice(0, 20), order_merchant_status_description: "Zamówienie wysłane" },
  }
  try {
    await client.orderEvent(orderId, payload)
    await updateRow(scope, row.id, {
      ...(event.kind === "canceled" ? { order_status: "ORDER_REJECTED" } : {}),
      events: withEvent(row.events, { kind: "sent", message: event.kind === "canceled" ? "Told InPost: order rejected (canceled in the store)" : `Told InPost: shipped (${event.references.join(", ") || "no number"})`, ...(o.demo ? { demo: true } : {}) }),
    })
  } catch (e) {
    loggerOf(scope).warn(`[inpostpay] Order event for ${orderId} failed: ${(e as Error)?.message ?? e}`)
    await updateRow(scope, row.id, { events: withEvent(row.events, { kind: "failed", message: `The order event did not reach InPost: ${String((e as Error)?.message ?? e).slice(0, 200)}` }) }).catch(() => undefined)
  }
}
