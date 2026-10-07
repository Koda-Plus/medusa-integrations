import { Module } from "@medusajs/framework/utils"
import KodaStripeModuleService from "./service"
import { STRIPE_MODULE } from "./lib/constants"

/**
 * Stripe module of Stripe by Koda Plus: options, the key and masking. It
 * works next to the official Stripe payment provider and never replaces it.
 * Read only by construction (see `lib/client.ts`), no tables, no links.
 *
 * Registered under `koda_stripe`, never `stripe`: see `lib/constants.ts`.
 */
export { STRIPE_MODULE }
export type { StripePluginOptions } from "./lib/options"
export type { CheckResultDto, OrderPaymentDto, PaymentRowDto, StripeChecksResponse, StripeOrderResponse, StripeOverviewResponse } from "./lib/contract"

export default Module(STRIPE_MODULE, {
  service: KodaStripeModuleService,
})
