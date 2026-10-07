/**
 * THE ORDER WIDGET (and the order summaries): the PaymentIntents behind one
 * order, read from Stripe one by one and cached per PaymentIntent for
 * `cacheSeconds`, or built by the demo generator for the order.
 *
 * - The cache keeps the normalized payment (no client secret, no billing
 *   details, no dispute evidence), and the dispute deadlines are counted
 *   again at every answer.
 * - The key carries what Medusa records about the payment (captured,
 *   canceled, refunds), so a capture or a refund in Medusa reads Stripe again
 *   in every process, and the widget's Refresh (`fresh`) reads again once
 *   the last read is 30 seconds old.
 * - When Stripe does not answer, the last good read is served, marked stale.
 */
import { ERROR_CACHE_MS, FORCE_REFRESH_MIN_MS } from "../../modules/stripe/lib/constants"
import type { OrderLinkDto, OrderPaymentDto, StripeMode, StripeOrderResponse } from "../../modules/stripe/lib/contract"
import { demoPaymentForOrder, type DemoOrder } from "../../modules/stripe/lib/demo"
import { isFailure, toFailure, type ReadFailure } from "../../modules/stripe/lib/errors"
import { disputesAt } from "../../modules/stripe/lib/normalize"
import { orderPaymentFrom, unreadPayment } from "../../modules/stripe/lib/order-payment"
import type { RawDispute, RawPaymentIntent } from "../../modules/stripe/lib/stripe-types"
import { dashboardFor, loadSnapshot, type Snapshot } from "./snapshot"
import { cacheFor, clientFor, readDemoOrder, readOrderPaymentRefs, stripeService, type OrderPaymentRef, type Scope } from "./runtime"

/** Stripe reads one answer may still make; shared by the orders of a batch. */
export interface ReadBudget {
  left: number
}

/** The mode of the reads: the key's, or "unconfigured" without one (demo is handled apart). */
export function liveMode(scope: Scope): StripeMode {
  const svc = stripeService(scope)
  if (!svc.isConfigured()) return "unconfigured"
  return svc.keyInfo().mode === "test" ? "test" : "live"
}

function at(dto: OrderPaymentDto, now: Date, readAt: number | null, stale: boolean): OrderPaymentDto {
  return { ...dto, disputes: disputesAt(dto.disputes, now), readAt: readAt === null ? null : new Date(readAt).toISOString(), stale }
}

/** The cache key of one PaymentIntent of an order: the mode, the id, and what Medusa records about it. */
export function paymentKey(mode: StripeMode, ref: Pick<OrderPaymentRef, "paymentIntentId" | "stamp">): string {
  return `order:${mode}:${ref.paymentIntentId}:${ref.stamp}`
}

/** The last read of a PaymentIntent the cache still holds, whatever its age, without asking Stripe. */
export function cachedPayment(scope: Scope, ref: OrderPaymentRef, mode: StripeMode, now: Date): OrderPaymentDto | null {
  const last = cacheFor(stripeService(scope)).good<OrderPaymentDto>(paymentKey(mode, ref))
  return last ? at(last.value, now, last.at, false) : null
}

/** A PaymentIntent of the 30 days the snapshot holds, shaped like the widget's read (without the fee details). */
export function paymentFromSnapshot(snapshot: Snapshot, ref: OrderPaymentRef, args: { now: Date; at: number; stale: boolean }): OrderPaymentDto | null {
  const row = snapshot.payments.find((p) => p.id === ref.paymentIntentId)
  if (!row) return null
  return at(
    {
      id: row.id,
      providerId: ref.providerId,
      found: true,
      problem: null,
      problemMessage: null,
      permission: null,
      payment: row,
      feeDetails: [],
      exchangeRate: null,
      availableOn: null,
      refunds: snapshot.refunds.filter((r) => r.paymentIntent === row.id),
      disputes: snapshot.disputes.filter((d) => d.paymentIntent === row.id),
      outcome: null,
      livemode: null,
      readAt: null,
      stale: false,
    },
    args.now,
    args.at,
    args.stale,
  )
}

/**
 * The PaymentIntents of one order, each from the cache or from one read of
 * Stripe (a GET of the PaymentIntent with its charge, balance transaction and
 * refunds, and the disputes only when the charge says it is disputed). With a
 * `budget`, a payment the cache does not hold is read only while the budget
 * lasts; past it, the last read the cache still has stands in, or the payment
 * is left unread ("skipped").
 */
export async function stripePaymentsOf(
  scope: Scope,
  refs: readonly OrderPaymentRef[],
  order: OrderLinkDto,
  args: { mode: StripeMode; now: Date; force?: boolean; budget?: ReadBudget },
): Promise<OrderPaymentDto[]> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  if (!svc.isConfigured()) return refs.map((r) => unreadPayment(r.paymentIntentId, r.providerId, "unconfigured"))
  const client = clientFor(scope, svc)
  const cache = cacheFor(svc)
  const dashboard = dashboardFor(args.mode === "test" ? "test" : "live")
  const ttlMs = o.cacheSeconds * 1000
  const out: OrderPaymentDto[] = []
  for (const ref of refs) {
    const key = paymentKey(args.mode, ref)
    const cached = cache.peek<OrderPaymentDto>(key)
    const fresh = cached !== null && args.now.getTime() - cached.at < ttlMs && !args.force
    if (!fresh && args.budget && args.budget.left <= 0) {
      const last = cache.good<OrderPaymentDto>(key)
      out.push(last ? at(last.value, args.now, last.at, false) : unreadPayment(ref.paymentIntentId, ref.providerId, "skipped"))
      continue
    }
    if (!fresh && args.budget) args.budget.left -= 1
    const hit = await cache.get<OrderPaymentDto | ReadFailure>(
      key,
      async () => {
        try {
          const pi = await client.get<RawPaymentIntent>(`/payment_intents/${ref.paymentIntentId}`, { expand: ["latest_charge.balance_transaction", "latest_charge.refunds"] })
          const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null
          const disputes = charge?.disputed ? (await client.list<RawDispute>("/disputes", { payment_intent: ref.paymentIntentId }, { maxPages: 1, limit: 10 })).data : []
          /* Normalized before it is kept: no client secret, billing details or dispute evidence in memory. */
          return orderPaymentFrom({ pi, disputes, providerId: ref.providerId, order, dashboard, demo: false, now: args.now })
        } catch (err) {
          return toFailure(err, [o.apiKey])
        }
      },
      { ttlMs, force: args.force, forceMinMs: FORCE_REFRESH_MIN_MS, errorTtlMs: ERROR_CACHE_MS, isFailure: (v) => isFailure(v) },
    )
    const value = hit.value
    if (!isFailure(value)) {
      out.push(at(value, args.now, hit.at, false))
      continue
    }
    const last = cache.good<OrderPaymentDto>(key)
    out.push(last ? at(last.value, args.now, last.at, true) : unreadPayment(ref.paymentIntentId, ref.providerId, value))
  }
  return out
}

/** The demo payment of one order (null when Stripe would not have paid it). */
export async function demoPaymentOf(scope: Scope, order: DemoOrder, args: { origin: string | null; now: Date }): Promise<OrderPaymentDto | null> {
  const svc = stripeService(scope)
  const { snapshot, at: readAt } = await loadSnapshot(scope, { origin: args.origin, now: () => args.now })
  const data = snapshot.demo
  if (!data) return null
  const built = demoPaymentForOrder(data, order, args.now)
  if (!built) return null
  const { pi } = built
  const dashboard = dashboardFor("demo")
  const disputes = data.disputes.filter((d) => (typeof d.payment_intent === "object" && d.payment_intent ? d.payment_intent.id : d.payment_intent) === pi.id)
  const payment = orderPaymentFrom({ pi, disputes, providerId: order.provider ?? `pp_stripe_${svc.getOptions().providerId}`, order: { id: order.id, displayId: order.displayId }, dashboard, demo: true, now: args.now })
  return { ...payment, readAt: new Date(readAt).toISOString() }
}

export async function loadOrderPayments(scope: Scope, orderId: string, args: { origin: string | null; now?: () => Date; force?: boolean } = { origin: null }): Promise<StripeOrderResponse> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const now = (args.now ?? (() => new Date()))()

  if (svc.isDemo()) {
    const dashboard = dashboardFor("demo")
    const order = await readDemoOrder(scope, orderId, o.demoOrders)
    const payment = order ? await demoPaymentOf(scope, order, { origin: args.origin, now }) : null
    if (!payment) return { mode: "demo", configured: true, orderId, payments: [], none: true, dashboardUrl: dashboard.base }
    return { mode: "demo", configured: true, orderId, payments: [payment], none: false, dashboardUrl: dashboard.base }
  }

  const mode = liveMode(scope)
  const dashboard = dashboardFor(mode === "test" ? "test" : "live")
  const { found, displayId, refs } = await readOrderPaymentRefs(scope, orderId)
  if (!found || refs.length === 0) return { mode, configured: svc.isConfigured(), orderId, payments: [], none: true, dashboardUrl: dashboard.base }
  const payments = await stripePaymentsOf(scope, refs, { id: orderId, displayId }, { mode, now, force: args.force })
  return { mode, configured: svc.isConfigured(), orderId, payments, none: false, dashboardUrl: dashboard.base }
}
