import { Module } from "@medusajs/framework/utils"
import CreditModuleService from "./service"
import { CREDIT_MODULE } from "./lib/constants"

/**
 * Trade Credit module: per-customer credit limits and payment terms for B2B
 * stores, with the used amount from the customer's unpaid orders and the
 * overdue check.
 */
export { CREDIT_MODULE }
export type { CreditPluginOptions } from "./lib/options"
export type { LimitDto, CreditOrderDto, StatusResponse } from "./lib/contract"

export default Module(CREDIT_MODULE, {
  service: CreditModuleService,
})
