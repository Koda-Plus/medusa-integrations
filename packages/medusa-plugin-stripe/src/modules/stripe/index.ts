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
/* Money in every DTO is an integer in the currency's minor unit (`MoneyDto.amount`), never major units. */
export type {
  CheckResultDto,
  DisputeRowDto,
  MoneyDto,
  OrderPaymentDto,
  PaymentFilter,
  PaymentRowDto,
  RefundRowDto,
  SessionKind,
  StripeChecksResponse,
  StripeOrderResponse,
  StripeOverviewResponse,
  StripePaymentsResponse,
  StripeStatusResponse,
} from "./lib/contract"

export default Module(STRIPE_MODULE, {
  service: KodaStripeModuleService,
})
