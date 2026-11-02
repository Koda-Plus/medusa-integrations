/**
 * TRACKING OF IMPORTED ORDERS. The seller API takes no tracking number: a
 * shipment made in ShipX with the order's InPost e-mail address (the
 * `delivery.email` this plugin puts on the Medusa order) is linked by
 * InPost and shows up in the order's `delivery.parcels`.
 *
 * When an imported order gets a fulfillment or a shipment, its tracking
 * numbers are recorded on our row and compared with the parcels the
 * marketplace shows: `linked` when all are there, `waiting` while some are
 * not (the next sync reads the order again). Never throws into the Medusa
 * flow that triggered it.
 *
 * `demoShip` (demo mode only) fulfils and ships a simulated order with a
 * sample tracking number through Medusa's own workflows, and the simulated
 * marketplace links the parcel as InPost would.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import * as coreFlows from "@medusajs/medusa/core-flows"
import { demoTrackingNumber } from "../../modules/vonhalsky/lib/demo"
import { trackingStatus } from "../../modules/vonhalsky/lib/offer-sync"
import { trackingNumbersOf, type FulfillmentLike } from "../../modules/vonhalsky/lib/shipping"
import { logSync, toOrderDto, vonHalskySvc, withEvent } from "../../modules/vonhalsky/lib/store"
import type { MarketplaceOrderDto } from "../../modules/vonhalsky/lib/contract"
import { refreshOrderRow } from "./orders"
import { VonHalskyFlowError, clientOf, demoClientOf, errorText, optionsOf, queryOf, withLock } from "./runtime"

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

export type TrackingOutcome = "none" | "linked" | "waiting"

/**
 * Records the order's tracking numbers and reads the marketplace order
 * again (`fresh`), so the panel says whether InPost linked the parcels.
 * A no-op for orders that did not come from the marketplace.
 */
export async function syncTracking(container: MedusaContainer, orderId: string, opts: { fresh?: boolean } = {}): Promise<{ outcome: TrackingOutcome; order: MarketplaceOrderDto | null }> {
  const row0 = await rowOfOrder(container, orderId)
  if (!row0) return { outcome: "none", order: null }
  return withLock(`tracking:${orderId}`, async () => {
    const svc = vonHalskySvc(container)
    const o = optionsOf(container)
    let row = (await rowOfOrder(container, orderId)) ?? row0
    const numbers = trackingNumbersOf(await fulfillmentsOf(container, orderId))
    const known = Array.isArray(row.tracking_numbers) ? row.tracking_numbers.map(String) : []
    const added = numbers.filter((n) => !known.includes(n))
    if (added.length > 0) {
      row = await svc.updateVonHalskyOrders({
        id: row.id,
        tracking_numbers: [...new Set([...known, ...numbers])],
        events: withEvent(row.events, { kind: "tracking", message: `Tracking ${added.join(", ")} in Medusa`, ...(o.demo ? { demo: true } : {}) }),
      })
    }
    if (opts.fresh !== false) {
      const client = clientOf(container)
      try {
        const order = client ? await client.getOrder(String(row.marketplace_order_id)) : null
        if (order) row = (await refreshOrderRow(container, order)) ?? row
      } catch (err) {
        await logSync(container, { area: "tracking", action: "read", outcome: "warning", message: `Order ${row.marketplace_order_id}: ${errorText(err, container)}`, demo: o.demo, refs: { order_id: orderId } })
      }
    }
    const status = trackingStatus(Array.isArray(row.tracking_numbers) ? row.tracking_numbers.map(String) : [], Array.isArray(row.parcels) ? row.parcels : [])
    if (status !== row.tracking_status) row = await svc.updateVonHalskyOrders({ id: row.id, tracking_status: status })
    if (added.length > 0) {
      await logSync(container, {
        area: "tracking",
        action: "record",
        outcome: status === "waiting" ? "warning" : "ok",
        message: `Order ${row.marketplace_order_id}: tracking ${added.join(", ")} ${status === "linked" ? "is on the marketplace" : "is not on the marketplace yet (ship with the order's InPost e-mail in ShipX)"}.`,
        count: added.length,
        demo: o.demo,
        refs: { order_id: orderId },
      })
    }
    return { outcome: status === "none" ? ("none" as const) : status, order: toOrderDto(row) }
  })
}

/**
 * DEMO MODE ONLY: fulfil every unfulfilled item of a simulated order and
 * mark it shipped with a sample tracking number (it starts with 99, no real
 * parcel has it). Medusa emits `order.fulfillment_created` and
 * `shipment.created` as for any shipment; the subscribers record the
 * tracking, and the simulated marketplace shows the parcel. Called again,
 * it only syncs.
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
      /* The simulated marketplace links the parcel, as InPost does for a ShipX shipment with the order's e-mail. */
      demoClientOf(container)?.addParcel(String(row.marketplace_order_id), number)
    } catch (err) {
      throw new VonHalskyFlowError(409, "ship_failed", `Medusa could not fulfil the simulated order: ${errorText(err, container)}. Fulfil it in Orders instead.`)
    }
  }
  const { order: after } = await syncTracking(container, order.id)
  if (after) return after
  const [fresh] = ((await svc.listVonHalskyOrders({ id: rowId }, { take: 1 })) ?? []) as Row[]
  return toOrderDto(fresh ?? row)
}
