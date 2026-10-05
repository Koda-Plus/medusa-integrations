import { Module } from "@medusajs/framework/utils"
import FakturowniaModuleService from "./service"
import { FAKTUROWNIA_MODULE } from "./lib/constants"

/**
 * Fakturownia module: the document outbox (one row per order and kind, with
 * what Fakturownia made of it: number, payment, KSeF status) and the history
 * of background runs. Talks to Fakturownia only through `lib/client.ts`.
 */
export { FAKTUROWNIA_MODULE }
export type { FakturowniaPluginOptions } from "./lib/options"

export default Module(FAKTUROWNIA_MODULE, {
  service: FakturowniaModuleService,
})
