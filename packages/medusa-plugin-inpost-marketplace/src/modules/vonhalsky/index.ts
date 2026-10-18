import { Module } from "@medusajs/framework/utils"
import VonHalskyModuleService from "./service"
import { VONHALSKY_MODULE } from "./lib/constants"

/**
 * InPost Von Halsky module: the InPost marketplace. Medusa variants become
 * marketplace offers, marketplace orders become Medusa orders, tracking
 * numbers go back. The tables keep the offers, the imported orders, the
 * sync log and the admin settings.
 */
export { VONHALSKY_MODULE }
export type { VonHalskyPluginOptions, ResolvedVonHalskyOptions, VonHalskyMode } from "./lib/options"
export type { OfferDto, MarketplaceOrderDto, StatusResponse, VonHalskySettings } from "./lib/contract"
export type { MarketplaceClient, MarketplaceOrder } from "./lib/client"

export default Module(VONHALSKY_MODULE, {
  service: VonHalskyModuleService,
})
