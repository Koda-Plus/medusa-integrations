import { Module } from "@medusajs/framework/utils"
import LoyaltyModuleService from "./service"
import { LOYALTY_MODULE } from "./lib/constants"

/**
 * Loyalty module: points for every order, a reward ladder, redemption and
 * manual adjustments.
 */
export { LOYALTY_MODULE }
export type { LoyaltyPluginOptions, LoyaltyReward } from "./lib/options"
export type { AccountDto, TxDto, StatusResponse, StoreLoyaltyData } from "./lib/contract"

export default Module(LOYALTY_MODULE, {
  service: LoyaltyModuleService,
})
