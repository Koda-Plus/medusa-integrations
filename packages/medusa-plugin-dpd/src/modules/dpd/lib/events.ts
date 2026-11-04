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
 *                                InfoServices status pass or a refresh
 *                                (simulated in sandbox and demo)
 *   dpd.shipment.delivered       once, when every waybill of the shipment is
 *                                delivered (after its status_changed)
 *   dpd.return.created           once per return, when the return label
 *                                exists
 *
 * All four carry `DpdShipmentEvent`. `demo: true` marks a simulated
 * shipment of demo mode: a subscriber that writes to the outside world
 * should skip it outside its own demo.
 *
 * dpd.shipment.created comes from the shipment flows (stage 2), the two
 * status events from the status pass and the refresh of one shipment
 * (stage 5); dpd.return.created is declared for the returns of stage 6.
 * Each event is emitted at most once: after the won compare and set of the
 * row; a failed emit is logged, never retried. In the sandbox the statuses
 * are simulated: `mode` says so, `demo` stays false.
 *
 * THE SHAPE IS A CONTRACT: add a field or a new event, never change one.
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
  /** The code of the newest DPD event that is not a notification, also one unknown to the code map, like "190101"; it is not always the code that set the stage. SIM_ codes (SIM_IN_POINT) come only from the simulator of sandbox and demo mode. Null before any status. */
  status: string | null
  previous_status: string | null
  /** Where the shipment is: preparing, ready, in_transit, in_point, delivered, problem, returned, canceled; ready is set by the handover, not by DPD. */
  stage: ShipmentStage
  /** A public Pickup point id (PL14509), for Pickup options. */
  pudo_id: string | null
  /** The destination country (ISO alpha-2). */
  country_code: string | null
  /** Cash on delivery, the exact amount as a string ("199.99"). */
  cod: { amount: string; currency: CodCurrency } | null
  mode: DpdMode
  demo: boolean
  /** The stage before this change; null for dpd.shipment.created and for a first stage. */
  previous_stage: ShipmentStage | null
  /** The dpd_event id of the DPD event that changed the stage (status_changed, delivered); a subscriber dedupes by it. Null for created, and when that event was stored by an earlier pass. */
  event_id: string | null
}
