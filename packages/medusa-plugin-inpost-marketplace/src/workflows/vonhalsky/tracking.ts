/**
 * TRACKING BACK TO THE MARKETPLACE. When an imported order gets a
 * fulfillment or a shipment with tracking numbers (the labels of its
 * fulfillments), the new numbers go back:
 *
 *   demo                 recorded on our row ("tracking sent", demo), nothing leaves the server;
 *   sendTracking on      sent through the client (pending in this version: noted as waiting);
 *   sendTracking off     noted on the row, so the panel shows they wait for the writer.
 *
 * Never throws into the Medusa flow that triggered it: the fulfillment
 * already exists, failing here would not undo it. A person can resend from
 * the panel.
 *
 * `demoShip` (demo mode only) fulfils and ships a simulated order with a
 * sample tracking number through Medusa's own workflows, so the subscribers
 * see exactly what a real shipment would give them.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import * as coreFlows from "@medusajs/medusa/core-flows"
import { isPending } from "../../modules/vonhalsky/lib/client"
import { demoTrackingNumber } from "../../modules/vonhalsky/lib/demo"
import { trackingDecision, trackingNumbersOf, type FulfillmentLike } from "../../modules/vonhalsky/lib/shipping"
import { logSync, toOrderDto, vonHalskySvc, withEvent } from "../../modules/vonhalsky/lib/store"
import type { MarketplaceOrderDto } from "../../modules/vonhalsky/lib/contract"
import { VonHalskyFlowError, clientOf, errorText, optionsOf, queryOf, withLock } from "./runtime"

type Row = Record<string, any>

async function rowOfOrder(container: MedusaContainer, orderId: string): Promise<Row | null> {
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)) return null
  const [row] = ((await vonHalskySvc(container).listVonHalskyOrders({ order_id: orderId }, { take: 1 })) ?? []) as Row[]
  return row ?? null
}

async function fulfillmentsOf(container: MedusaContainer, orderId: string): Promise<FulfillmentLike[]> {
  const { data } = await queryOf(container).graph({ entity: "order", fields: ["id", "fulfillments.id", "fulfillments.canceled_at", "fulfillments.labels.tracking_number"], filters: { id: orderId } })
  return (((data as Array<{ fulfillments?: FulfillmentLike[] | null }>)[0]?.fulfillments ?? []) as FulfillmentLike[]).filter(Boolean)
}

export type TrackingOutcome = "none" | "recorded" | "sent" | "waiting" | "failed"

/** Looks at the order's tracking numbers and sends (or records) the new ones. A no-op for orders that did not come from the marketplace. */
export async function syncTracking(container: MedusaContainer, orderId: string, opts: { force?: boolean } = {}): Promise<{ outcome: TrackingOutcome; order: MarketplaceOrderDto | null }> {
  const row0 = await rowOfOrder(container, orderId)
  if (!row0) return { outcome: "none", order: null }
  return withLock(`tracking:${orderId}`, async () => {
    const svc = vonHalskySvc(container)
    const o = optionsOf(container)
    const row = (await rowOfOrder(container, orderId)) ?? row0
    const numbers = trackingNumbersOf(await fulfillmentsOf(container, orderId))
    /* A resend asked by a person: what failed or waited goes again. */
    const sent = opts.force && row.tracking_status !== "sent" ? [] : row.tracking_numbers
    const decision = trackingDecision({ imported: row.status === "imported", numbers, sent, demo: o.demo, sendTracking: o.sendTracking })
    if (decision.kind === "none") return { outcome: "none" as const, order: toOrderDto(row) }
    const all = [...new Set([...(Array.isArray(row.tracking_numbers) ? row.tracking_numbers.map(String) : []), ...decision.numbers])]
    if (decision.kind === "off") {
      const updated = await svc.updateVonHalskyOrders({ id: row.id, tracking_status: "none", events: withEvent(row.events, { kind: "tracking", message: `Tracking ${decision.numbers.join(", ")} not sent: the tracking writer (sendTracking) is off` }) })
      return { outcome: "waiting" as const, order: toOrderDto(updated) }
    }
    const client = clientOf(container)
    try {
      if (!client) throw new VonHalskyFlowError(409, "not_configured", "InPost Von Halsky is not configured.")
      await client.sendTracking(String(row.marketplace_order_id), decision.numbers)
      const updated = await svc.updateVonHalskyOrders({
        id: row.id,
        tracking_status: "sent",
        tracking_numbers: all,
        tracking_sent_at: new Date(),
        error: null,
        events: withEvent(row.events, { kind: "tracking", message: o.demo ? `Tracking ${decision.numbers.join(", ")} recorded (demo: nothing was sent)` : `Tracking ${decision.numbers.join(", ")} sent to InPost Von Halsky`, ...(o.demo ? { demo: true } : {}) }),
      })
      await logSync(container, { area: "tracking", action: "send", message: `Order ${row.marketplace_order_id}: tracking ${decision.numbers.join(", ")} ${o.demo ? "recorded (demo)" : "sent"}.`, count: decision.numbers.length, demo: o.demo, refs: { order_id: orderId } })
      return { outcome: o.demo ? ("recorded" as const) : ("sent" as const), order: toOrderDto(updated) }
    } catch (err) {
      const pending = isPending(err)
      const message = errorText(err, container)
      const updated = await svc.updateVonHalskyOrders({
        id: row.id,
        tracking_status: pending ? "pending_api" : "failed",
        error: message.slice(0, 800),
        events: withEvent(row.events, { kind: pending ? "tracking" : "failed", message: pending ? `Tracking ${decision.numbers.join(", ")} waits for the seller API` : `Tracking did not reach the marketplace: ${message.slice(0, 200)}` }),
      })
      await logSync(container, { area: "tracking", action: "send", outcome: pending ? "warning" : "error", message: `Order ${row.marketplace_order_id}: ${message}`, demo: o.demo, refs: { order_id: orderId } })
      return { outcome: pending ? ("waiting" as const) : ("failed" as const), order: toOrderDto(updated) }
    }
  })
}

/**
 * DEMO MODE ONLY: fulfil every unfulfilled item of a simulated order and
 * mark it shipped with a sample tracking number (it starts with 99, no real
 * parcel has it). Medusa emits `order.fulfillment_created` and
 * `shipment.created` as for any shipment; the subscribers record the
 * tracking. Called again, it only syncs.
 */
export async function demoShip(container: MedusaContainer, rowId: string): Promise<MarketplaceOrderDto> {
  const o = optionsOf(container)
  if (!o.demo) throw new VonHalskyFlowError(404, "not_demo", "The simulated shipment exists only in demo mode.")
  const svc = vonHalskySvc(container)
  const [row] = ((await svc.listVonHalskyOrders({ id: rowId }, { take: 1 })) ?? []) as Row[]
  if (!row || !row.order_id) throw new VonHalskyFlowError(404, "not_found", "Imported order not found.")
  const { data } = await queryOf(container).graph({
    entity: "order",
    /* The items in FULL: with partial item fields Query leaves `quantity` out (seen on Medusa 2.15.3). */
    fields: ["id", "status", "items.*", "items.detail.*", "shipping_methods.shipping_option_id"],
    filters: { id: row.order_id },
  })
  const order = (data as Array<{ id: string; status: string; items?: Array<{ id: string; quantity: number; detail?: { fulfilled_quantity?: number | null } | null } | null> | null; shipping_methods?: Array<{ shipping_option_id?: string | null } | null> | null }>)[0]
  if (!order) throw new VonHalskyFlowError(404, "not_found", "The Medusa order no longer exists.")
  if (order.status === "canceled") throw new VonHalskyFlowError(409, "canceled", "The order is canceled.")
  const items = (order.items ?? [])
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => ({ id: i.id, quantity: Math.max(0, Number(i.quantity) - Number(i.detail?.fulfilled_quantity ?? 0)) }))
    .filter((i) => i.quantity > 0)
  if (items.length > 0) {
    if (!order.shipping_methods?.some((m) => m?.shipping_option_id)) {
      throw new VonHalskyFlowError(409, "no_shipping_option", "The order has no shipping option: map one in Settings, Shipping, and simulate a new order.")
    }
    try {
      const { result: fulfillment } = await coreFlows.createOrderFulfillmentWorkflow(container).run({ input: { order_id: order.id, items } })
      const number = demoTrackingNumber(`${row.marketplace_order_id}:${(fulfillment as { id: string }).id}`)
      await coreFlows.createOrderShipmentWorkflow(container).run({
        input: { order_id: order.id, fulfillment_id: (fulfillment as { id: string }).id, items, labels: [{ tracking_number: number, tracking_url: "", label_url: "" }], no_notification: true },
      })
    } catch (err) {
      throw new VonHalskyFlowError(409, "ship_failed", `Medusa could not fulfil the simulated order: ${errorText(err, container)}. Fulfil it in Orders instead.`)
    }
  }
  const { order: after } = await syncTracking(container, order.id)
  if (after) return after
  const [fresh] = ((await svc.listVonHalskyOrders({ id: rowId }, { take: 1 })) ?? []) as Row[]
  return toOrderDto(fresh ?? row)
}
