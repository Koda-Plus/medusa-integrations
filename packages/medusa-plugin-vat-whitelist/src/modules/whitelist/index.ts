import { Module } from "@medusajs/framework/utils"
import WhitelistModuleService from "./service"
import { WHITELIST_MODULE } from "./lib/constants"

/**
 * VAT Whitelist module: verifies Polish NIPs against the Ministry of Finance
 * whitelist and EU VAT numbers against VIES, keeps the counterparties and
 * the check history.
 */
export { WHITELIST_MODULE }
export type { WhitelistPluginOptions } from "./lib/options"
export type { EntityDto, CheckDto, StatusResponse } from "./lib/contract"

export default Module(WHITELIST_MODULE, {
  service: WhitelistModuleService,
})
