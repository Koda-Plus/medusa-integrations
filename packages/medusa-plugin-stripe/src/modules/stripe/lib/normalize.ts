/**
 * STRIPE OBJECTS TO ROWS. No runtime imports beyond the pure helpers.
 *
 * Every parser here takes a raw Stripe object (live, or built by the demo
 * generator: both go through the same code) and returns the row the admin
 * shows, with money as integers in minor units and a link to the Medusa
 * order when the payment came from one.
 *
 * HOW A PAYMENT FINDS ITS ORDER. The official provider creates every
 * PaymentIntent with `metadata.session_id`, the Medusa payment session. The
 * session belongs to a payment collection, and a completed cart links that
 * collection to the order. So: PaymentIntent, session id, collection, order.
 * A PaymentIntent without `session_id` was not created by Medusa (another
 * tool on the same account) and is shown as such. One with a `session_id`
 * this Medusa does not know came from another Medusa on the same account (a
 * second store, a staging server), unless it was canceled: then it is a
 * session Medusa replaced when the customer changed the method.
 */
import { compareDisputes, disputeDeadline, isOpenDispute } from "./disputes"
import type { DashboardLinks } from "./dashboard"
import type { BalanceDto, DisputeRowDto, MoneyDto, OrderLinkDto, PaymentRowDto, PaymentStatus, PayoutRowDto, RefundRowDto, RiskLevel, SessionKind } from "./contract"
import { chargeOf, classifyPaymentIntent, methodOfType } from "./methods"
import { money, MoneyBag } from "./money"
import { maskSecrets } from "./security"
import type { RawBalance, RawBalanceTransaction, RawDispute, RawPaymentIntent, RawPayout, RawRefund } from "./stripe-types"

export interface OrderLookup {
  /** The order of a Medusa payment session, if the session's cart became one. */
  orderOf(sessionId: string | null | undefined): OrderLinkDto | null
  /** The cart of a session that has no order. */
  cartOf?(sessionId: string | null | undefined): string | null
  /** This Medusa has the session. Absent when Medusa could not be asked: then the session's kind is unknown (null). */
  known?(sessionId: string): boolean
}

export const NO_ORDERS: OrderLookup = { orderOf: () => null, cartOf: () => null }

/** Whose checkout a PaymentIntent with a session id came from (see SessionKind). */
export function sessionKind(sessionId: string | null, status: PaymentStatus, orders: OrderLookup): SessionKind | null {
  if (!sessionId || !orders.known) return null
  if (orders.known(sessionId)) return "known"
  return status === "canceled" ? "replaced" : "foreign"
}

export interface NormalizeContext {
  dashboard: DashboardLinks
  orders: OrderLookup
  demo: boolean
}

/** What the checks need to know about a payment, beyond the row the admin sees. */
export interface PaymentFacts {
  id: string
  created: number
  status: PaymentStatus
  currency: string
  amount: number
  captureMethod: string | null
  /** The intent let Stripe pick the methods from the Dashboard settings (`automatic_payment_methods`). */
  automatic: boolean
  /** The methods Stripe offered for this intent. */
  methodTypes: string[]
  sessionId: string | null
  /** Whose checkout (see SessionKind); null without a session id or when Medusa could not be asked. */
  session: SessionKind | null
  orderId: string | null
  cartId: string | null
  livemode: boolean | null
}

const iso = (seconds: unknown): string | null => (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null)

const idOf = (value: unknown): string | null => {
  if (typeof value === "string" && value) return value
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id
  return null
}

const RISK: readonly string[] = ["normal", "elevated", "highest", "not_assessed", "unknown"]

export function paymentStatus(pi: RawPaymentIntent): PaymentStatus {
  switch (pi.status) {
    case "succeeded":
      return "succeeded"
    case "processing":
      return "processing"
    case "requires_capture":
      return "authorized"
    case "requires_action":
      return "requires_action"
    case "canceled":
      return "canceled"
    case "requires_payment_method":
      return pi.last_payment_error ? "failed" : "incomplete"
    default:
      return "incomplete"
  }
}

/** A declined attempt counts as failed in the rates even when the intent was canceled afterwards. */
export function attemptFailed(row: Pick<PaymentRowDto, "status" | "failure">): boolean {
  return row.status === "failed" || (row.status === "canceled" && row.failure !== null)
}

function balanceTransaction(value: unknown): RawBalanceTransaction | null {
  return value && typeof value === "object" ? (value as RawBalanceTransaction) : null
}

export function normalizePaymentIntent(pi: RawPaymentIntent, ctx: NormalizeContext): { row: PaymentRowDto; facts: PaymentFacts } | null {
  const id = typeof pi.id === "string" ? pi.id : null
  const amount = money(pi.amount, pi.currency)
  if (!id || !amount) return null
  const charge = chargeOf(pi)
  const status = paymentStatus(pi)
  const classified = classifyPaymentIntent(pi)
  const bt = status === "succeeded" || charge?.captured ? balanceTransaction(charge?.balance_transaction) : null
  const sessionId = typeof pi.metadata?.session_id === "string" && pi.metadata.session_id ? pi.metadata.session_id : null
  const order = sessionId ? ctx.orders.orderOf(sessionId) : null
  const cartId = sessionId && !order ? (ctx.orders.cartOf?.(sessionId) ?? null) : null
  const received = typeof pi.amount_received === "number" && pi.amount_received > 0 ? money(pi.amount_received, pi.currency) : null
  const refundedAmount = typeof charge?.amount_refunded === "number" && charge.amount_refunded > 0 ? money(charge.amount_refunded, charge.currency ?? pi.currency) : null
  const riskRaw = charge?.outcome?.risk_level
  const risk = typeof riskRaw === "string" ? ((RISK.includes(riskRaw) ? riskRaw : "unknown") as RiskLevel) : null
  const error = pi.last_payment_error
  const failure =
    error && (error.code || error.decline_code || error.message)
      ? { code: error.decline_code || error.code || null, message: error.message ? maskSecrets(error.message) : null }
      : status === "failed" && charge?.failure_code
        ? { code: charge.failure_code, message: charge.failure_message ? maskSecrets(charge.failure_message) : null }
        : null
  const created = typeof pi.created === "number" ? pi.created * 1000 : 0

  const row: PaymentRowDto = {
    id,
    created: new Date(created).toISOString(),
    amount,
    received: status === "succeeded" ? (received ?? amount) : received,
    status,
    stripeStatus: String(pi.status ?? ""),
    captureMethod: typeof pi.capture_method === "string" ? pi.capture_method : null,
    method: classified?.method ?? null,
    detail: classified?.detail ?? null,
    fee: bt ? money(bt.fee, bt.currency) : null,
    net: bt ? money(bt.net, bt.currency) : null,
    refunded: refundedAmount,
    disputed: charge?.disputed === true,
    risk,
    failure,
    fromMedusa: sessionId !== null,
    session: sessionKind(sessionId, status, ctx.orders),
    disputeOpen: false,
    refundFailed: false,
    order,
    cartId,
    dashboardUrl: ctx.dashboard.payment(id),
    demo: ctx.demo,
  }
  const facts: PaymentFacts = {
    id,
    created,
    status,
    currency: amount.currency,
    amount: amount.amount,
    captureMethod: row.captureMethod,
    automatic: pi.automatic_payment_methods?.enabled === true,
    methodTypes: Array.isArray(pi.payment_method_types) ? pi.payment_method_types.filter((t): t is string => typeof t === "string") : [],
    sessionId,
    session: row.session,
    orderId: order?.id ?? null,
    cartId,
    livemode: typeof pi.livemode === "boolean" ? pi.livemode : null,
  }
  return { row, facts }
}

/** The session id of a PaymentIntent object (expanded on a refund or a dispute), for the order lookup. */
export function sessionOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const s = (value as RawPaymentIntent).metadata?.session_id
  return typeof s === "string" && s ? s : null
}

export function normalizeRefund(r: RawRefund, ctx: NormalizeContext): RefundRowDto | null {
  const id = typeof r.id === "string" ? r.id : null
  const amount = money(r.amount, r.currency)
  if (!id || !amount) return null
  const pi = idOf(r.payment_intent)
  return {
    id,
    paymentIntent: pi,
    created: iso(r.created) ?? new Date(0).toISOString(),
    amount,
    status: String(r.status ?? "pending"),
    reason: typeof r.reason === "string" ? r.reason : null,
    failureReason: typeof r.failure_reason === "string" ? r.failure_reason : null,
    order: ctx.orders.orderOf(sessionOf(r.payment_intent)),
    dashboardUrl: ctx.dashboard.payment(pi),
    demo: ctx.demo,
  }
}

export function normalizeDispute(d: RawDispute, ctx: NormalizeContext & { now: Date; methodOf?: (paymentIntent: string | null) => PaymentRowDto["method"] }): DisputeRowDto | null {
  const id = typeof d.id === "string" ? d.id : null
  const amount = money(d.amount, d.currency)
  if (!id || !amount) return null
  const pi = idOf(d.payment_intent)
  const status = String(d.status ?? "")
  const deadline = disputeDeadline({ status, dueBy: d.evidence_details?.due_by, pastDue: d.evidence_details?.past_due, now: ctx.now })
  const method = methodOfType(d.payment_method_details?.type) ?? ctx.methodOf?.(pi) ?? null
  return {
    id,
    paymentIntent: pi,
    created: iso(d.created) ?? new Date(0).toISOString(),
    amount,
    status,
    open: isOpenDispute(status),
    reason: typeof d.reason === "string" ? d.reason : null,
    method,
    dueBy: deadline.dueBy,
    daysLeft: deadline.daysLeft,
    urgency: deadline.urgency,
    hasEvidence: d.evidence_details?.has_evidence === true,
    submissions: typeof d.evidence_details?.submission_count === "number" ? d.evidence_details.submission_count : 0,
    order: ctx.orders.orderOf(sessionOf(d.payment_intent)),
    dashboardUrl: ctx.dashboard.dispute(id),
    demo: ctx.demo,
  }
}

export function sortDisputes(rows: DisputeRowDto[]): DisputeRowDto[] {
  return [...rows].sort(compareDisputes)
}

/**
 * The days left and the urgency of a dispute at `now`: a read kept in the
 * cache would otherwise still say "2 days left" after the deadline passed.
 */
export function disputeAt(row: DisputeRowDto, now: Date): DisputeRowDto {
  const due = row.dueBy ? Date.parse(row.dueBy) : NaN
  const deadline = disputeDeadline({ status: row.status, dueBy: Number.isFinite(due) ? due / 1000 : null, pastDue: !row.dueBy && row.urgency === "overdue", now })
  return { ...row, daysLeft: deadline.daysLeft, urgency: deadline.urgency }
}

/** Every dispute at `now`, the most pressing first. */
export function disputesAt(rows: readonly DisputeRowDto[], now: Date): DisputeRowDto[] {
  return sortDisputes(rows.map((d) => disputeAt(d, now)))
}

export function normalizePayout(p: RawPayout, ctx: NormalizeContext): PayoutRowDto | null {
  const id = typeof p.id === "string" ? p.id : null
  const amount = money(p.amount, p.currency)
  if (!id || !amount) return null
  return {
    id,
    amount,
    created: iso(p.created) ?? new Date(0).toISOString(),
    arrivalDate: iso(p.arrival_date),
    status: String(p.status ?? "pending"),
    method: typeof p.method === "string" ? p.method : null,
    automatic: p.automatic !== false,
    failureMessage: typeof p.failure_message === "string" ? maskSecrets(p.failure_message) : null,
    dashboardUrl: ctx.dashboard.payout(id),
    demo: ctx.demo,
  }
}

/** Upcoming payouts (on their way) and past ones (paid, failed, canceled), each newest first. */
export function splitPayouts(rows: PayoutRowDto[]): { upcoming: PayoutRowDto[]; past: PayoutRowDto[] } {
  const byArrival = (a: PayoutRowDto, b: PayoutRowDto) => (b.arrivalDate ?? b.created).localeCompare(a.arrivalDate ?? a.created)
  return {
    upcoming: rows.filter((p) => p.status === "pending" || p.status === "in_transit").sort((a, b) => -byArrival(a, b)),
    past: rows.filter((p) => p.status !== "pending" && p.status !== "in_transit").sort(byArrival),
  }
}

function amounts(list: RawBalance["available"]): MoneyDto[] {
  const bag = new MoneyBag()
  for (const a of Array.isArray(list) ? list : []) bag.add(money(a?.amount, a?.currency))
  return bag.list()
}

export function normalizeBalance(b: RawBalance | null | undefined): BalanceDto | null {
  if (!b || typeof b !== "object") return null
  return { available: amounts(b.available), pending: amounts(b.pending) }
}

/** Every currency the balance holds: a PLN balance means PLN payments settle in PLN. */
export function balanceCurrencies(b: BalanceDto | null): string[] {
  if (!b) return []
  return [...new Set([...b.available, ...b.pending].map((m) => m.currency))]
}
