import { Module } from "@medusajs/framework/utils"
import CeneoModuleService from "./service"
import { CENEO_MODULE } from "./lib/constants"

/**
 * Ceneo module: the Ceneo XML offer feed built from the catalog, the offers
 * with their problems, and (in later parts) Zaufane Opinie, Kup Teraz
 * orders and CPC bids through the Ceneo API.
 */
export { CENEO_MODULE }
export type { CeneoPluginOptions } from "./lib/options"
export type { StatusResponse, FeedBuildDto } from "./lib/contract"

export default Module(CENEO_MODULE, {
  service: CeneoModuleService,
})
