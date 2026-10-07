import { Module } from "@medusajs/framework/utils"
import InpostModuleService from "./service"
import { INPOST_MODULE } from "./lib/constants"

/**
 * InPost module: the shipments of the InPost fulfillments (what the customer
 * chose, the ShipX shipment, its status), their history and the settings.
 * The fulfillment provider itself is `src/providers/inpost`, registered in
 * Medusa's fulfillment module; it records the choice and never calls ShipX.
 */
export { INPOST_MODULE }
export { PROVIDER_IDENTIFIER, OPTION_IDS } from "./lib/constants"
export type { InpostOptionId, ParcelKind, ParcelSize, LabelSize } from "./lib/constants"
export type { InpostPluginOptions, InpostSenderOption } from "./lib/options"
/* The contract other plugins build on: the events of a shipment. */
export { SHIPMENT_CREATED_EVENT, SHIPMENT_STATUS_CHANGED_EVENT, SHIPMENT_DELIVERED_EVENT } from "./lib/events"
export type { InpostShipmentEvent } from "./lib/events"
export type { ShipmentStage } from "./lib/statuses"
export { shipmentStage, trackingUrl } from "./lib/statuses"
export { InpostApiError } from "./lib/errors"

export default Module(INPOST_MODULE, {
  service: InpostModuleService,
})
