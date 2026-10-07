/**
 * THE FULFILLMENT STATUS WRITER (off by default): Medusa follows InPost.
 *
 *   InPost has the parcel (picked up from the sender, or dropped off at a
 *   locker or a point)  ->  the Medusa fulfillment is shipped, with the
 *                           tracking number and link as its label
 *                           (Medusa's own createOrderShipmentWorkflow, which
 *                           emits shipment.created, so an "order shipped"
 *                           e-mail carries the InPost tracking link)
 *   delivered            ->  the fulfillment is delivered
 *                           (markOrderFulfillmentAsDeliveredWorkflow)
 *
 * Each happens once per fulfillment: an atomic claim on the row
 * (`shipped_marked_at`, `delivered_marked_at`) before the Medusa flow runs,
 * released with the error when the flow fails, so the next status pass tries
 * again. A fulfillment a person already marked is only noted, never marked
 * twice. In demo mode Medusa is never touched: the history says what would
 * have happened.
 */

import { isPickedUp, trackingUrl } from "../../modules/inpost/lib/statuses"
import type { ParcelRow } from "../../modules/inpost/lib/dto"
import { inpostService, isArmed, loadOrder, recordEvent, resolveOptional, storeFor, type Scope } from "./runtime"

type CoreFlows = {
  createOrderShipmentWorkflow: (scope: unknown) => { run(args: { input: Record<string, unknown> }): Promise<unknown> }
  markOrderFulfillmentAsDeliveredWorkflow: (scope: unknown) => { run(args: { input: Record<string, unknown> }): Promise<unknown> }
}

/** Container key the tests register stand-ins of the two core flows under. */
export const CORE_FLOWS_KEY = "inpostCoreFlows"

/** Medusa's core flows, loaded when first needed. */
async function coreFlows(scope: Scope): Promise<CoreFlows> {
  return resolveOptional<CoreFlows>(scope, CORE_FLOWS_KEY) ?? ((await import("@medusajs/medusa/core-flows")) as unknown as CoreFlows)
}

const already = (message: string) => /already|has been (shipped|delivered)|is (shipped|delivered)/i.test(message)

export async function syncFulfillmentStatus(scope: Scope, row: ParcelRow): Promise<void> {
  if (!row.fulfillment_id || row.state !== "created" || !row.status) return
  const shipped = isPickedUp(row.status)
  const delivered = row.status === "delivered"
  const wantShip = shipped && !row.shipped_marked_at
  const wantDeliver = delivered && !row.delivered_marked_at
  if (!wantShip && !wantDeliver) return
  const svc = inpostService(scope)
  if (!(await isArmed(svc, "fulfillmentStatus"))) return
  const store = storeFor(scope)
  const now = new Date()

  if (svc.isDemo()) {
    if (wantShip && (await store.claimMark(row.id, "shipped_marked_at", now))) {
      await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "demo", message: "Simulated: the Medusa fulfillment would be marked shipped with the tracking number.", data: { action: "mark_shipped" }, demo: true })
    }
    if (wantDeliver && (await store.claimMark(row.id, "delivered_marked_at", now))) {
      await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "demo", message: "Simulated: the Medusa fulfillment would be marked delivered.", data: { action: "mark_delivered" }, demo: true })
    }
    return
  }

  const order = await loadOrder(scope, row.order_id)
  const f = order?.fulfillments?.find((x) => x.id === row.fulfillment_id)
  if (!order || !f || f.canceled_at) return

  if (wantShip && (await store.claimMark(row.id, "shipped_marked_at", now))) {
    if (f.shipped_at) {
      await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "system", message: "The Medusa fulfillment was already shipped.", data: { action: "mark_shipped", outcome: "already" }, demo: false })
    } else {
      try {
        const { createOrderShipmentWorkflow } = await coreFlows(scope)
        const items = (f.items ?? []).reduce<Array<{ id: string; quantity: number }>>((acc, i) => {
          const hit = acc.find((x) => x.id === i.line_item_id)
          if (hit) hit.quantity += Number(i.quantity ?? 0)
          else acc.push({ id: i.line_item_id, quantity: Number(i.quantity ?? 0) })
          return acc
        }, [])
        await createOrderShipmentWorkflow(scope).run({
          input: {
            order_id: row.order_id,
            fulfillment_id: row.fulfillment_id,
            items,
            labels: row.tracking_number ? [{ tracking_number: row.tracking_number, tracking_url: trackingUrl(row.tracking_number), label_url: "" }] : [],
          },
        })
        await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "system", message: "Medusa fulfillment marked shipped with the tracking number.", data: { action: "mark_shipped" }, demo: false })
      } catch (err) {
        const message = svc.mask((err as Error)?.message ?? String(err)).slice(0, 500)
        if (!already(message)) {
          await store.releaseMark(row.id, "shipped_marked_at", message)
          svc.getLogger().warn(`[inpost] mark shipped ${row.id}: ${message}`)
          return
        }
      }
    }
  }

  if (wantDeliver && (await store.claimMark(row.id, "delivered_marked_at", now))) {
    if (f.delivered_at) return
    try {
      const { markOrderFulfillmentAsDeliveredWorkflow } = await coreFlows(scope)
      await markOrderFulfillmentAsDeliveredWorkflow(scope).run({ input: { orderId: row.order_id, fulfillmentId: row.fulfillment_id } })
      await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "system", message: "Medusa fulfillment marked delivered.", data: { action: "mark_delivered" }, demo: false })
    } catch (err) {
      const message = svc.mask((err as Error)?.message ?? String(err)).slice(0, 500)
      if (!already(message)) {
        await store.releaseMark(row.id, "delivered_marked_at", message)
        svc.getLogger().warn(`[inpost] mark delivered ${row.id}: ${message}`)
      }
    }
  }
}
