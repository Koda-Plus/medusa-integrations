import { Module } from "@medusajs/framework/utils"
import BaseLinkerModuleService from "./service"
import { BASELINKER_MODULE } from "./lib/constants"

/**
 * BaseLinker module: the card snapshot linked to variants, the order outbox
 * with the way back (status, tracking, fulfillment), the stock plan and the
 * history of background runs. Talks to BaseLinker only through
 * `lib/client.ts`, behind the write barrier of `lib/security.ts`.
 */
export { BASELINKER_MODULE }
export type { BaseLinkerPluginOptions } from "./lib/options"

export default Module(BASELINKER_MODULE, {
  service: BaseLinkerModuleService,
})
