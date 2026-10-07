import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import InpostFulfillmentProvider from "./service"

/**
 * The fulfillment provider of InPost by Koda Plus, for Medusa's fulfillment
 * module, with the same options object as the plugin:
 *
 *   { resolve: "@koda-plus/medusa-plugin-inpost/providers/inpost", id: "inpost", options: inpost }
 */
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [InpostFulfillmentProvider],
})
