import { Module } from "@medusajs/framework/utils"
import InpostPayModuleService from "./service"
import { INPOSTPAY_MODULE } from "./lib/constants"

/**
 * InPost Pay module: one-click checkout with the InPost mobile app. The
 * store binds a cart to an InPost Pay basket, InPost calls the Merchant
 * Backend API of the store, and the order comes in through the plugin's
 * payment provider. The tables keep the baskets and the admin settings.
 */
export { INPOSTPAY_MODULE }
export type { InpostPayPluginOptions, ResolvedInpostPayOptions, InpostPayMode } from "./lib/options"
export type { BasketDto, StatusResponse, StoreBasketResponse, StoreConfigResponse, InpostPaySettings } from "./lib/contract"

export default Module(INPOSTPAY_MODULE, {
  service: InpostPayModuleService,
})
