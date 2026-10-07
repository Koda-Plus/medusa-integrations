import type { InpostService, ParcelKind } from "./constants"
import type { LockerAddress } from "./lockers"
import { shipmentStage, trackingUrl, type ShipmentStage } from "./statuses"

/**
 * THE EVENTS OTHER PLUGINS BUILD ON (an e-mail "your parcel is in the
 * locker", a Slack note about a return). Plain data, no personal data: the
 * receiver's name, phone and e-mail are never in an event.
 *
 *   inpost.shipment.created         once per shipment, when ShipX accepts it
 *                                   (or the plugin adopts one it found)
 *   inpost.shipment.status_changed  once per change of the ShipX status,
 *                                   from the webhook or the status pass
 *   inpost.shipment.delivered       once, when the status becomes delivered
 *                                   (after its status_changed)
 *
 * All three carry `InpostShipmentEvent`. `demo: true` marks a simulated
 * shipment of demo mode: a subscriber that writes to the outside world
 * should skip it outside its own demo.
 *
 * THE SHAPE IS A CONTRACT: add a field or a new event, never change one.
 */

export const SHIPMENT_CREATED_EVENT = "inpost.shipment.created"
export const SHIPMENT_STATUS_CHANGED_EVENT = "inpost.shipment.status_changed"
export const SHIPMENT_DELIVERED_EVENT = "inpost.shipment.delivered"

export interface InpostShipmentEvent {
  /** The plugin's row of the shipment (`inpar_...`). */
  id: string
  order_id: string
  fulfillment_id: string | null
  /** The ShipX shipment id. */
  shipment_id: string
  tracking_number: string | null
  /** https://inpost.pl/sledzenie-przesylek?number=..., when there is a number. */
  tracking_url: string | null
  /** The ShipX status, like "ready_to_pickup". */
  status: string
  previous_status: string | null
  /** Where the shipment is: preparing, ready, in_transit, in_locker, delivered, problem, returned, canceled. */
  stage: ShipmentStage
  service: InpostService
  kind: ParcelKind
  locker: { code: string; name: string | null; address: LockerAddress | null } | null
  /** Cash on delivery, the exact amount as a string ("199.99"). */
  cod: { amount: string; currency: "PLN" } | null
  demo: boolean
}

export interface EventSourceRow {
  id: string
  order_id: string
  fulfillment_id: string | null
  shipment_id: string | null
  tracking_number: string | null
  status: string | null
  service: string
  kind: string
  locker_code: string | null
  locker_name: string | null
  locker_address: LockerAddress | null
  cod: boolean
  cod_amount: string | null
  demo: boolean
}

export function eventData(row: EventSourceRow, previousStatus: string | null): InpostShipmentEvent | null {
  if (!row.shipment_id || !row.status) return null
  return {
    id: row.id,
    order_id: row.order_id,
    fulfillment_id: row.fulfillment_id ?? null,
    shipment_id: row.shipment_id,
    tracking_number: row.tracking_number ?? null,
    /* Demo numbers never lead to inpost.pl. */
    tracking_url: row.tracking_number && !row.demo ? trackingUrl(row.tracking_number) : null,
    status: row.status,
    previous_status: previousStatus,
    stage: shipmentStage(row.status),
    service: row.service as InpostService,
    kind: row.kind === "courier" ? "courier" : "locker",
    locker: row.kind === "locker" && row.locker_code ? { code: row.locker_code, name: row.locker_name ?? null, address: row.locker_address ?? null } : null,
    cod: row.cod && row.cod_amount ? { amount: row.cod_amount, currency: "PLN" } : null,
    demo: Boolean(row.demo),
  }
}

/** The events of a new shipment: created. */
export function createdEvents(row: EventSourceRow): Array<{ name: string; data: InpostShipmentEvent }> {
  const data = eventData(row, null)
  return data ? [{ name: SHIPMENT_CREATED_EVENT, data }] : []
}

/** The events of a status change: status_changed, and delivered when it became delivered. Nothing when the status did not change. */
export function statusEvents(row: EventSourceRow, previousStatus: string | null): Array<{ name: string; data: InpostShipmentEvent }> {
  if (!row.status || row.status === previousStatus) return []
  const data = eventData(row, previousStatus)
  if (!data) return []
  const out = [{ name: SHIPMENT_STATUS_CHANGED_EVENT, data }]
  if (row.status === "delivered") out.push({ name: SHIPMENT_DELIVERED_EVENT, data })
  return out
}
