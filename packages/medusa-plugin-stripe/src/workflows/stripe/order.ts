/**
 * THE ORDER WIDGET: the PaymentIntents behind one order, read from Stripe
 * one by one (cached per PaymentIntent for `cacheSeconds`), or built by the
 * demo generator for the order.
 */
import { ERROR_CACHE_MS } from "../../modules/stripe/lib/constants"
import type { OrderPaymentDto, StripeMode, StripeOrderResponse } from "../../modules/stripe/lib/contract"
import { demoPaymentForOrder } from "../../modules/stripe/lib/demo"
import { toFailure, type ReadFailure } from "../../modules/stripe/lib/errors"
import { orderPaymentFrom, unreadPayment } from "../../modules/stripe/lib/order-payment"
import type { RawDispute, RawPaymentIntent } from "../../modules/stripe/lib/stripe-types"
import { dashboardFor, loadSnapshot } from "./snapshot"
import { cacheFor, clientFor, readDemoOrder, readOrderPaymentRefs, stripeService, type Scope } from "./runtime"

type PaymentRead = { pi: RawPaymentIntent; disputes: RawDispute[] } | ReadFailure

export async function loadOrderPayments(scope: Scope, orderId: string, args: { origin: string | null; now?: () => Date } = { origin: null }): Promise<StripeOrderResponse> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const now = (args.now ?? (() => new Date()))()

  if (svc.isDemo()) {
    const order = await readDemoOrder(scope, orderId)
    const dashboard = dashboardFor("demo")
    if (!order) return { mode: "demo", configured: true, orderId, payments: [], none: true, dashboardUrl: dashboard.base }
    const { snapshot } = await loadSnapshot(scope, { origin: args.origin, now: () => now })
    const data = snapshot.demo
    if (!data) return { mode: "demo", configured: true, orderId, payments: [], none: true, dashboardUrl: dashboard.base }
    const { pi } = demoPaymentForOrder(data, order, now)
    const disputes = data.disputes.filter((d) => (typeof d.payment_intent === "object" && d.payment_intent ? d.payment_intent.id : d.payment_intent) === pi.id)
    const payment = orderPaymentFrom({ pi, disputes, providerId: `pp_stripe_${o.providerId}`, order: { id: order.id, displayId: order.displayId }, dashboard, demo: true, now })
    return { mode: "demo", configured: true, orderId, payments: [payment], none: false, dashboardUrl: dashboard.base }
  }

  const key = svc.keyInfo()
  const mode: StripeMode = !svc.isConfigured() ? "unconfigured" : key.mode === "test" ? "test" : "live"
  const dashboard = dashboardFor(mode === "test" ? "test" : "live")
  const { found, displayId, refs } = await readOrderPaymentRefs(scope, orderId)
  if (!found || refs.length === 0) return { mode, configured: svc.isConfigured(), orderId, payments: [], none: true, dashboardUrl: dashboard.base }
  if (!svc.isConfigured()) {
    return { mode, configured: false, orderId, payments: refs.map((r) => unreadPayment(r.paymentIntentId, r.providerId, "unconfigured")), none: false, dashboardUrl: dashboard.base }
  }

  const client = clientFor(scope, svc)
  const cache = cacheFor(svc)
  const payments: OrderPaymentDto[] = []
  for (const ref of refs) {
    const hit = await cache.get<PaymentRead>(
      `order:${mode}:${ref.paymentIntentId}`,
      async () => {
        try {
          const pi = await client.get<RawPaymentIntent>(`/payment_intents/${ref.paymentIntentId}`, { expand: ["latest_charge.balance_transaction", "latest_charge.refunds"] })
          const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null
          const disputes = charge?.disputed ? (await client.list<RawDispute>("/disputes", { payment_intent: ref.paymentIntentId }, { maxPages: 1, limit: 10 })).data : []
          return { pi, disputes }
        } catch (err) {
          return toFailure(err, [o.apiKey])
        }
      },
      { ttlMs: o.cacheSeconds * 1000, errorTtlMs: ERROR_CACHE_MS, isFailure: (v) => "error" in v },
    )
    const value = hit.value
    payments.push(
      "error" in value
        ? unreadPayment(ref.paymentIntentId, ref.providerId, value)
        : orderPaymentFrom({ pi: value.pi, disputes: value.disputes, providerId: ref.providerId, order: { id: orderId, displayId }, dashboard, demo: false, now }),
    )
  }
  return { mode, configured: true, orderId, payments, none: false, dashboardUrl: dashboard.base }
}
