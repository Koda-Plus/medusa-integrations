import { Module } from "@medusajs/framework/utils"
import KitModuleService from "./service"
import { KIT_MODULE } from "./lib/constants"

/**
 * Kit module: the newsletter of the store on the Kit list. The storefront
 * form subscribes customers (upsert + tags + double opt-in form), the admin
 * shows the account, the list settings and the subscription log.
 */
export { KIT_MODULE }
export type { KitPluginOptions } from "./lib/options"
export type { SubscriberDto, SubscriptionResult, StatusResponse } from "./lib/contract"

export default Module(KIT_MODULE, {
  service: KitModuleService,
})
