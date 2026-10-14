import { Module } from "@medusajs/framework/utils"
import KodaCouponsModuleService from "./service"
import { COUPONS_MODULE } from "./lib/constants"

/**
 * Coupons module of Coupons by Koda Plus: the options. No tables, no links:
 * every coupon is a standard promotion of Medusa's promotion module.
 *
 * Registered under `koda_coupons`, never `coupons`: see `lib/constants.ts`.
 */
export { COUPONS_MODULE }
export type { CouponsPluginOptions } from "./lib/options"
export type {
  CouponDto,
  CouponShape,
  CouponStats,
  CouponStatus,
  CouponKind,
  ListResponse,
  DetailResponse,
  LookupsResponse,
  WizardInput,
  CreateResponse,
  CustomerCouponsResponse,
  OrderCouponsResponse,
  ProductCouponsResponse,
} from "./lib/contract"

export default Module(COUPONS_MODULE, {
  service: KodaCouponsModuleService,
})
