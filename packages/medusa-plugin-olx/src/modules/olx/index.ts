import { Module } from "@medusajs/framework/utils"
import OlxModuleService from "./service"
import { OLX_MODULE } from "./lib/constants"

/**
 * OLX module: connection to an OLX seller account through the OLX Partner
 * API and a snapshot of its adverts linked to product variants by SKU.
 * Read-only towards OLX by design (see `lib/security.ts`).
 */
export { OLX_MODULE }
export type { OlxPluginOptions } from "./lib/options"

export default Module(OLX_MODULE, {
  service: OlxModuleService,
})
