import { Module } from "@medusajs/framework/utils"
import AllegroModuleService from "./service"
import { ALLEGRO_MODULE } from "./lib/constants"

/**
 * Allegro module: connection to an Allegro seller account through the device
 * flow, a snapshot of its offers linked to product variants by signature,
 * the stock check and a read-only order journal. Read-only towards Allegro by
 * design (see `lib/security.ts`).
 */
export { ALLEGRO_MODULE }
export type { AllegroPluginOptions } from "./lib/options"

export default Module(ALLEGRO_MODULE, {
  service: AllegroModuleService,
})
