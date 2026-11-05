import { Module } from "@medusajs/framework/utils"
import DpdModuleService from "./service"
import { DPD_MODULE } from "./lib/constants"

/**
 * DPD module: the shipments of the DPD fulfillments (what the customer chose,
 * the DPD waybills, the stored labels, the status), the handovers to the
 * courier, their history and the settings. The fulfillment provider itself
 * is `src/providers/dpd`, registered in Medusa's fulfillment module; it
 * records the choice and never calls DPD.
 */
export { DPD_MODULE }
export { PROVIDER_IDENTIFIER, PROVIDER_ID_PATTERN, OPTION_IDS, isDpdProviderId } from "./lib/constants"
export type { DpdMode, DpdOptionId, OptionKind, ShipmentKind, ShipmentState, ShipmentStage, LabelPage, CodCurrency } from "./lib/constants"
export type { DpdPluginOptions, DpdBoxOption } from "./lib/options"
export type { DpdSenderOption, DpdOrdererOption } from "./lib/sender"
/* The contract other plugins build on: the events of a shipment. */
export { SHIPMENT_CREATED_EVENT, SHIPMENT_STATUS_CHANGED_EVENT, SHIPMENT_DELIVERED_EVENT, RETURN_CREATED_EVENT } from "./lib/events"
export type { DpdShipmentEvent } from "./lib/events"

export default Module(DPD_MODULE, {
  service: DpdModuleService,
})
