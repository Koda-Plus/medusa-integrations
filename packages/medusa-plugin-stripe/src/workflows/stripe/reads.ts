/**
 * The reads behind the admin page, as plain functions of the container (or
 * a request scope), sharing one cache with the admin. Exported for your own
 * code through `@koda-plus/medusa-plugin-stripe/workflows`. All of them only
 * read: nothing here can charge, capture, refund or pay out.
 */
import type { StripeChecksResponse, StripeOrderResponse, StripeOverviewResponse } from "../../modules/stripe/lib/contract"
import { loadChecks } from "./health"
import { loadOrderPayments } from "./order"
import { emptyOverview, overviewOf } from "./overview"
import { stripeService, type Scope } from "./runtime"
import { loadSnapshot } from "./snapshot"

/** The panel: 7 and 30 day figures by method, payments, disputes, refunds, balance and payouts. */
export async function loadStripeOverview(scope: Scope, options: { force?: boolean; origin?: string | null } = {}): Promise<StripeOverviewResponse> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  if (!svc.isConfigured()) return emptyOverview({ cacheSeconds: o.cacheSeconds, mode: "unconfigured" })
  const { snapshot, fresh } = await loadSnapshot(scope, { force: options.force, origin: options.origin ?? null })
  return overviewOf(snapshot, { now: new Date(), cacheSeconds: o.cacheSeconds, fresh, configured: true })
}

/** The health checks with a verdict and a fix each. `origin` is this backend's public address, for the webhook check. */
export async function runStripeChecks(scope: Scope, options: { force?: boolean; origin?: string | null } = {}): Promise<StripeChecksResponse> {
  return loadChecks(scope, { force: options.force, origin: options.origin ?? null })
}

/** The Stripe payments of one order, for the order widget. */
export async function loadStripeOrder(scope: Scope, orderId: string, options: { origin?: string | null } = {}): Promise<StripeOrderResponse> {
  return loadOrderPayments(scope, orderId, { origin: options.origin ?? null })
}
