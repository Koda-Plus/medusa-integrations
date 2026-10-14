/**
 * The reads and writes behind the admin page, for your own code (a report,
 * a job that pauses expired campaigns):
 *
 *   import { listCoupons } from "@koda-plus/medusa-plugin-coupons/workflows"
 *   const { coupons } = await listCoupons(container)
 *
 * A coupon is a standard Medusa promotion; these functions only read it
 * through Query and write it through Medusa's own promotion workflows.
 */
export { listCoupons, couponDetail, customerCoupons, orderCoupons, productCoupons, lookups, searchCustomers } from "./coupons/reads"
export { createCoupon, setCouponStatus, CouponInputError } from "./coupons/create"
/** koda.integration/1 for in-process hosts: `couponsIntegration.build.summaries(ctx, "order", ids)` answers without HTTP. */
export { couponsIntegration } from "./coupons/integration"
