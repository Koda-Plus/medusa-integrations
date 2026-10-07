/**
 * ONE PAYMENTINTENT FOR THE ORDER WIDGET. No runtime imports beyond the pure helpers.
 *
 * The PaymentIntent comes with its latest charge, the charge's balance
 * transaction (fee, net, exchange rate, when the money is available) and its
 * refunds expanded; the disputes of the payment come from a second read only
 * when the charge says it is disputed.
 */
import { newestRefundFailed } from "./attention"
import type { OrderPaymentDto, OrderLinkDto } from "./contract"
import type { DashboardLinks } from "./dashboard"
import type { ReadFailure } from "./errors"
import { chargeOf } from "./methods"
import { money } from "./money"
import { normalizeDispute, normalizePaymentIntent, normalizeRefund, sortDisputes } from "./normalize"
import type { RawBalanceTransaction, RawDispute, RawPaymentIntent } from "./stripe-types"

export function orderPaymentFrom(args: {
  pi: RawPaymentIntent
  disputes: RawDispute[]
  providerId: string | null
  order: OrderLinkDto
  dashboard: DashboardLinks
  demo: boolean
  now: Date
}): OrderPaymentDto {
  /* The payment came from this order's own record in Medusa: its session is this Medusa's. */
  const orders = { orderOf: () => args.order, cartOf: () => null, known: () => true }
  const ctx = { dashboard: args.dashboard, orders, demo: args.demo }
  const n = normalizePaymentIntent(args.pi, ctx)
  const charge = chargeOf(args.pi)
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? (charge.balance_transaction as RawBalanceTransaction) : null
  const refunds = (charge?.refunds?.data ?? [])
    .map((r) => normalizeRefund({ ...r, payment_intent: r.payment_intent ?? args.pi.id }, ctx))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.created.localeCompare(a.created))
  const disputes = sortDisputes(
    args.disputes.map((d) => normalizeDispute(d, { ...ctx, now: args.now, methodOf: () => n?.row.method ?? null })).filter((d): d is NonNullable<typeof d> => d !== null),
  )
  const row = n ? { ...n.row, disputeOpen: disputes.some((d) => d.open), refundFailed: newestRefundFailed(refunds).has(n.row.id) } : null
  return {
    id: String(args.pi.id ?? ""),
    providerId: args.providerId,
    found: n !== null,
    problem: n ? null : "error",
    problemMessage: n ? null : "Stripe sent a payment without an amount.",
    permission: null,
    payment: row,
    feeDetails: (bt?.fee_details ?? [])
      .map((f) => {
        const amount = money(f?.amount, f?.currency)
        return amount ? { type: String(f?.type ?? "fee"), amount, description: typeof f?.description === "string" ? f.description : null } : null
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
    exchangeRate: typeof bt?.exchange_rate === "number" ? bt.exchange_rate : null,
    availableOn: typeof bt?.available_on === "number" ? new Date(bt.available_on * 1000).toISOString() : null,
    refunds,
    disputes,
    outcome: charge?.outcome
      ? { type: charge.outcome.type ?? null, sellerMessage: charge.outcome.seller_message ?? null, riskScore: typeof charge.outcome.risk_score === "number" ? charge.outcome.risk_score : null }
      : null,
    livemode: typeof args.pi.livemode === "boolean" ? args.pi.livemode : null,
    readAt: null,
    stale: false,
  }
}

/**
 * A PaymentIntent the plugin could not read, with the reason the widget shows.
 * "skipped": not read for this answer (a summary of many orders reads only a
 * few payments from Stripe; the rest come from what the cache holds).
 */
export function unreadPayment(id: string, providerId: string | null, failure: ReadFailure | "unconfigured" | "skipped"): OrderPaymentDto {
  const problem: OrderPaymentDto["problem"] =
    failure === "unconfigured" || failure === "skipped" ? failure : failure.kind === "not_found" ? "not_found" : failure.kind === "permission" ? "forbidden" : "error"
  const read = typeof failure === "object" ? failure : null
  return {
    id,
    providerId,
    found: false,
    problem,
    problemMessage: read ? read.error : null,
    permission: read ? read.permission : null,
    payment: null,
    feeDetails: [],
    exchangeRate: null,
    availableOn: null,
    refunds: [],
    disputes: [],
    outcome: null,
    livemode: null,
    readAt: null,
    stale: false,
  }
}
