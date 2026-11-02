import type { CodCurrency, DpdMode, DpdOptionId, ShipmentKind, ShipmentStage } from "./constants"

/**
 * THE EVENTS OTHER PLUGINS BUILD ON (an e-mail "your parcel is at the Pickup
 * point", a note about a return). Plain data, no personal data: the
 * receiver's name, phone, e-mail and street are never in an event.
 *
 *   dpd.shipment.created         once per shipment, when DPD gives its
 *                                waybills (or the plugin adopts a shipment
 *                                it found after an unclear answer)
 *   dpd.shipment.status_changed  once per change of the stage, from the
 *                                InfoServices status pass
 *   dpd.shipment.delivered       once, when every waybill of the shipment is
 *                                delivered (after its status_changed)
 *   dpd.return.created           once per return, when the return label
 *                                exists
 *
 * All four carry `DpdShipmentEvent`. `demo: true` marks a simulated
 * shipment of demo mode: a subscriber that writes to the outside world
 * should skip it outside its own demo.
 *
 * Stage 1 declares them; the flows of later stages emit them. THE SHAPE IS A
 * CONTRACT: add a field or a new event, never change one.
 */

export const SHIPMENT_CREATED_EVENT = "dpd.shipment.created"
export const SHIPMENT_STATUS_CHANGED_EVENT = "dpd.shipment.status_changed"
export const SHIPMENT_DELIVERED_EVENT = "dpd.shipment.delivered"
export const RETURN_CREATED_EVENT = "dpd.return.created"

export const DPD_EVENTS = [SHIPMENT_CREATED_EVENT, SHIPMENT_STATUS_CHANGED_EVENT, SHIPMENT_DELIVERED_EVENT, RETURN_CREATED_EVENT] as const
export type DpdEventName = (typeof DPD_EVENTS)[number]

export type DpdShipmentEvent = {
  /** The plugin's row of the shipment (`dpdshp_...`). */
  id: string
  /** Null only for a return not yet tied to its order. */
  order_id: string | null
  fulfillment_id: string | null
  /** The Medusa return of a return shipment. */
  return_id: string | null
  kind: ShipmentKind
  option_id: DpdOptionId | string
  /** The waybill of every box, in box order. */
  waybills: string[]
  /** The last InfoServices event code, like "230402"; null before any status. */
  status: string | null
  previous_status: string | null
  /** Where the shipment is: preparing, ready, in_transit, in_point, delivered, problem, returned, canceled. */
  stage: ShipmentStage
  /** A public Pickup point id (PL14509), for Pickup options. */
  pudo_id: string | null
  /** The destination country (ISO alpha-2). */
  country_code: string | null
  /** Cash on delivery, the exact amount as a string ("199.99"). */
  cod: { amount: string; currency: CodCurrency } | null
  mode: DpdMode
  demo: boolean
}
