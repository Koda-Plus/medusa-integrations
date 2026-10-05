import { Module } from "@medusajs/framework/utils"
import AllegroModuleService from "./service"
import { ALLEGRO_MODULE } from "./lib/constants"

/**
 * Allegro module: connection to an Allegro seller account through the device
 * flow, a snapshot of its offers linked to product variants by signature,
 * the stock check, the order journal and the writers (stock, order import,
 * parcels, invoices, prices, drafts). Every write is off until it is allowed
 * in the options AND armed by a person in the admin, and the HTTP client
 * only lets through the exact requests of armed writers (see
 * `lib/security.ts` and `lib/writers.ts`).
 */
export { ALLEGRO_MODULE }
export type { AllegroPluginOptions } from "./lib/options"

export default Module(ALLEGRO_MODULE, {
  service: AllegroModuleService,
})
