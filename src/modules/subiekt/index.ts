import { Module } from "@medusajs/framework/utils"
import SubiektModuleService from "./service"
import { SUBIEKT_MODULE } from "./lib/constants"

/**
 * Subiekt nexo module: the task queue towards the bridge, the documents
 * Subiekt issued for Medusa orders, the connection state and the history of
 * background runs. Talks to Subiekt only through the bridge contract
 * (`contract/openapi.yaml`).
 */
export { SUBIEKT_MODULE }
export type { SubiektPluginOptions } from "./lib/options"

export default Module(SUBIEKT_MODULE, {
  service: SubiektModuleService,
})
