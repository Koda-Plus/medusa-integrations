import { Module } from "@medusajs/framework/utils"
import NegotiationsModuleService from "./service"
import { NEGOTIATIONS_MODULE } from "./lib/constants"

/**
 * Negotiations module: price negotiation threads between logged-in
 * customers and the store team, their messages, the writer toggles, the run
 * history and the draft order outbox.
 */
export { NEGOTIATIONS_MODULE }
export type { NegotiationsPluginOptions } from "./lib/options"
/* The contract other plugins build on: the events and their data. */
export {
  NEGOTIATION_ACCEPTED,
  NEGOTIATION_COUNTERED,
  NEGOTIATION_EVENTS,
  NEGOTIATION_EXPIRED,
  NEGOTIATION_MESSAGE_ADDED,
  NEGOTIATION_OPENED,
  NEGOTIATION_REJECTED,
} from "./lib/events"
export type { NegotiationEventData, NegotiationEventName } from "./lib/events"
export type { NegotiationStatus } from "./lib/constants"
export type { StoreThreadDto, StoreMessageDto, ThreadDto, MessageDto } from "./lib/contract"

export default Module(NEGOTIATIONS_MODULE, {
  service: NegotiationsModuleService,
})
