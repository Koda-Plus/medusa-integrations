import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import DpdFulfillmentProvider from "./service"

/**
 * The fulfillment provider of DPD by Koda Plus, for Medusa's fulfillment
 * module, with the same options object as the plugin:
 *
 *   { resolve: "@koda-plus/medusa-plugin-dpd/providers/dpd", id: "dpd", options: dpd }
 */
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [DpdFulfillmentProvider],
})
