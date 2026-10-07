import type { MethodDetailDto, MethodKey, OrderPaymentDto, PaymentRowDto, StripeMode } from "./contract"
import { methodOfProvider } from "./demo"
import { needsResponse } from "./disputes"
import type { SummaryState } from "./kit-contract"
import type { CounterDraft, FactDraft, LinkDraft, MessageDraft, SummaryDraft } from "./kit-routes"
import { bankName, describeDetail } from "./methods"

/**
 * Stripe in the koda.integration/1 contract, as pure functions over what the
 * plugin read (testable without Medusa or Stripe): one line per order and
 * per customer, the payment fact of the overview card, and the board
 * counters.
 *
 * Every Stripe payment of the order counts and the worst one speaks: red (a
 * refund failed, a dispute lost or past its deadline, the last attempt
 * declined), then orange (a dispute to answer, a card authorization about to
 * expire, the customer has to act), blue (under way: the bank, a refund, a
 * dispute under review, an authorization to capture), green (paid, refunded,
 * a dispute won). Attempts that failed before a payment went through are
 * history, not a problem. Nothing comes from order metadata: the payments are
 * Medusa's own records, the facts are Stripe's.
 */

export const STRIPE_EXTERNAL_HOSTS = ["dashboard.stripe.com"] as const
export const ORDER_WIDGET = "stripe.order"

/** Card authorizations expire after about 7 days; two days before, capturing becomes a task. */
const AUTHORIZATION_DAYS = 7
const AUTHORIZATION_WARN_DAYS = 2
const DAY = 24 * 60 * 60 * 1000

/** What Medusa records about a PaymentIntent of the order (the payment module, never metadata). */
export interface MedusaFacts {
  payment: boolean
  capturedAt: string | null
  canceledAt: string | null
  refunds: number
}

export interface PaymentInput {
  paymentIntentId: string
  providerId: string | null
  medusa: MedusaFacts
  /** Stripe's side, or null when it was not read for this answer. */
  read: OrderPaymentDto | null
}

export interface SummaryContext {
  mode: StripeMode
  now: Date
  /** Money in minor units, formatted in the answer's language. */
  money: (minor: number, currency: string) => string
  /** A date in the answer's language and time zone. */
  date: (iso: string) => string
  /** A message of the plugin as a sentence in the answer's language (method names, an order's line inside a customer's). */
  text: (message: MessageDraft) => string
}

interface Line {
  state: SummaryState
  title: MessageDraft
  detail?: MessageDraft
  rank: number
  /** The payment went through, or is on its way: earlier failed attempts are history next to it. */
  live: boolean
  stale: boolean
  input: PaymentInput
  row: PaymentRowDto | null
}

/** Worst first. Grey lines (nothing could be read, nothing set up, nothing here) never hide a coloured one. */
export const STATE_RANK: Record<SummaryState, number> = { failed: 0, attention: 1, active: 2, ok: 3, unavailable: 4, off: 5, none: 6 }

const order = (key: string, params?: Record<string, string | number>): MessageDraft => ({ key: `integration.order.${key}`, ...(params ? { params } : {}) })

/** The method in a few words: "Visa 4242", "BLIK", "Przelewy24, mBank", "Apple Pay, Visa 4242". */
export function methodText(method: MethodKey | null, detail: MethodDetailDto | null, text: SummaryContext["text"]): string {
  const name = text({ key: `integration.method.${method ?? "stripe"}` })
  if (!detail) return name
  if (method === "p24") {
    const bank = bankName(detail.bank)
    return bank ? `${name}, ${bank}` : name
  }
  const card = detail.reference || detail.bank ? "" : describeDetail(detail)
  if (method === "card") return card || name
  if ((method === "apple_pay" || method === "google_pay") && card) return `${name}, ${card}`
  return name
}

const money = (ctx: SummaryContext, m: { amount: number; currency: string } | null | undefined): string => (m ? ctx.money(m.amount, m.currency) : "")

/** One payment as a line: its state, title and rank. */
export function paymentLine(input: PaymentInput, ctx: SummaryContext): Line {
  const base = { input, stale: Boolean(input.read?.stale), row: input.read?.payment ?? null }
  const line = (state: SummaryState, title: MessageDraft, live: boolean, detail?: MessageDraft): Line => ({ ...base, state, title, live, rank: STATE_RANK[state], ...(detail ? { detail } : {}) })
  const read = input.read
  if (!read || !read.found || !read.payment) {
    switch (read?.problem) {
      case "unconfigured": {
        /* No key: Medusa's record decides whether the money came in; the line says the plugin cannot look. */
        const { detail: _medusaOnly, ...m } = medusaLine(input, ctx)
        return { ...m, state: "off", title: order("unconfigured"), rank: STATE_RANK.off }
      }
      case "forbidden":
        return line("unavailable", order("forbidden"), false, read.permission ? order("permission", { permission: read.permission }) : undefined)
      case "not_found":
        return line("unavailable", order("notFound"), false)
      case "error":
        return line("unavailable", order("unreadable"), false)
      default:
        return medusaLine(input, ctx)
    }
  }
  const row = read.payment
  const live = row.status === "succeeded" || row.status === "processing" || row.status === "authorized" || row.status === "requires_action"

  /* A dispute speaks first: the most pressing one (they come sorted). */
  const open = read.disputes.find((d) => d.open)
  if (open) {
    if (needsResponse(open.status)) {
      if (open.urgency === "overdue") return line("failed", order("disputeOverdue"), live)
      return line("attention", open.dueBy ? order("disputeAnswer", { date: ctx.date(open.dueBy) }) : order("dispute"), live)
    }
    return line("active", order("disputeReview"), live)
  }
  const lost = read.disputes.find((d) => d.status === "lost")
  if (lost) return line("failed", order("disputeLost", { amount: money(ctx, lost.amount) }), live)

  /* Then the newest refund: a failed one went wrong, a pending one is under way. */
  const refund = read.refunds[0]
  if (refund?.status === "failed") return line("failed", order("refundFailed"), live)
  if (refund && (refund.status === "pending" || refund.status === "requires_action")) return line("active", order("refundPending"), live)

  switch (row.status) {
    case "succeeded": {
      if (row.refunded && row.refunded.amount >= row.amount.amount) return line("ok", order("refundedAll"), live)
      if (row.refunded) return line("ok", order("refundedPart", { amount: money(ctx, row.refunded), total: money(ctx, row.amount) }), live)
      if (read.disputes.some((d) => d.status === "won")) return line("ok", order("disputeWon"), live)
      return line("ok", order("paid", { method: methodText(row.method, row.detail, ctx.text) }), live)
    }
    case "processing":
      return line("active", order("processing"), live)
    case "authorized": {
      const expires = (Date.parse(row.created) || ctx.now.getTime()) + AUTHORIZATION_DAYS * DAY
      const date = ctx.date(new Date(expires).toISOString())
      if (expires - ctx.now.getTime() <= AUTHORIZATION_WARN_DAYS * DAY) return line("attention", order("authorizedSoon", { date }), live)
      return line("active", order("authorized", { date }), live)
    }
    case "requires_action":
      return line("attention", order("waitingCustomer"), live)
    case "failed":
      return line("failed", order("declined"), live)
    case "canceled":
      /* Canceled in Stripe while Medusa still holds the payment as authorized: an expired or voided authorization, the order is not paid. */
      if (input.medusa.payment && !input.medusa.capturedAt && !input.medusa.canceledAt) return line("failed", order("canceledStripe"), true)
      return line("none", order("canceled"), live)
    default:
      return line("active", order("notPaid"), live)
  }
}

/** A payment Stripe was not asked about for this answer: Medusa's own record speaks. */
function medusaLine(input: PaymentInput, ctx: SummaryContext): Line {
  const m = input.medusa
  const base = { input, stale: false, row: null, detail: order("medusaOnly") }
  const method = methodText(methodOfProvider(input.providerId), null, ctx.text)
  if (m.canceledAt) return { ...base, state: "none", title: order("canceled"), rank: STATE_RANK.none, live: false }
  if (m.capturedAt) return { ...base, state: "ok", title: order("paid", { method }), rank: STATE_RANK.ok, live: true }
  if (m.payment) return { ...base, state: "active", title: order("authorizedMedusa"), rank: STATE_RANK.active, live: true }
  return { ...base, state: "active", title: order("notPaid"), rank: STATE_RANK.active, live: false }
}

function paymentFact(line: Line, ctx: SummaryContext, admin: LinkDraft): FactDraft {
  const row = line.row
  const method = row ? methodText(row.method, row.detail, ctx.text) : methodText(methodOfProvider(line.input.providerId), null, ctx.text)
  const fact: FactDraft = { slot: "payment", priority: 80, value: { key: "integration.fact.method", params: { method } } }
  if (row?.status === "succeeded") {
    fact.sub = row.fee && row.net ? { key: "integration.fact.feeNet", params: { fee: money(ctx, row.fee), net: money(ctx, row.net) } } : { key: "integration.fact.feePending" }
  } else if (row) {
    fact.sub = { key: "integration.fact.amount", params: { amount: money(ctx, row.amount) } }
  }
  /* Demo ids never existed in Stripe: the plugin page instead of the Dashboard. */
  fact.link = row && !row.demo && ctx.mode !== "demo" ? { kind: "external", href: row.dashboardUrl } : admin
  return fact
}

const newest = (lines: Line[]): string | null =>
  lines
    .map((l) => l.input.read?.readAt ?? null)
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop() ?? null

function adminLink(ref: string): LinkDraft {
  return { kind: "admin", href: `/stripe?q=${encodeURIComponent(ref)}` }
}

/** The worst line of an order, and the line whose payment the order's facts describe. */
function linesOf(payments: PaymentInput[], ctx: SummaryContext): { lines: Line[]; pool: Line[]; worst: Line; main: Line } {
  const lines = payments.map((p) => paymentLine(p, ctx))
  const live = lines.filter((l) => l.live)
  const pool = live.length > 0 ? live : lines
  const worst = [...pool].sort((a, b) => a.rank - b.rank)[0]
  const main = pool.find((l) => l.row?.status === "succeeded") ?? pool.find((l) => l.row) ?? pool.find((l) => l.input.medusa.capturedAt) ?? worst
  return { lines, pool, worst, main }
}

/** The line of one order from the Stripe payments behind it (the order's own Medusa payments). */
export function orderSummary(payments: PaymentInput[], ctx: SummaryContext & { orderId: string; displayId: number | null }): SummaryDraft | undefined {
  if (payments.length === 0) return undefined
  const { lines, pool, worst, main } = linesOf(payments, ctx)
  const ref = ctx.displayId !== null ? String(ctx.displayId) : ctx.orderId
  const admin = adminLink(ref)
  const stale = lines.some((l) => l.stale)
  let detail: MessageDraft | undefined
  if (ctx.mode === "demo") detail = order("demo")
  else if (worst.detail) detail = worst.detail
  else if (stale) detail = order("stale")
  else if (pool.length > 1 && worst.state !== "ok") detail = order("more", { count: pool.length - 1 })
  else if (main.row && (main.row.risk === "elevated" || main.row.risk === "highest") && main.input.read?.outcome?.riskScore !== null && main.input.read?.outcome?.riskScore !== undefined) {
    detail = order("risk", { score: main.input.read.outcome.riskScore })
  }
  const links: LinkDraft[] = [admin]
  if (main.row && !main.row.demo && ctx.mode !== "demo") links.push({ kind: "external", href: main.row.dashboardUrl })
  return {
    state: worst.state,
    title: worst.title,
    ...(detail ? { detail } : {}),
    facts: [paymentFact(main, ctx, admin)],
    counts: { payments: lines.length, disputes: lines.reduce((n, l) => n + (l.input.read?.disputes.filter((d) => d.open).length ?? 0), 0) },
    links,
    widget: ORDER_WIDGET,
    updatedAt: newest(lines),
    stale,
  }
}

export interface CustomerOrderInput {
  orderId: string
  displayId: number | null
  payments: PaymentInput[]
}

/**
 * The line of one customer from the Stripe payments of their orders: the
 * worst order speaks ("Order #1042: dispute, answer by 9 Oct"); when every
 * order is fine, how many payments and the method they use most.
 */
export function customerSummary(orders: CustomerOrderInput[], ctx: SummaryContext): SummaryDraft | undefined {
  const paid = orders.filter((o) => o.payments.length > 0).map((o) => ({ o, ...linesOf(o.payments, ctx) }))
  if (paid.length === 0) return undefined
  const worst = [...paid].sort((a, b) => a.worst.rank - b.worst.rank)[0]
  const ref = (o: CustomerOrderInput) => (o.displayId !== null ? String(o.displayId) : o.orderId)
  const methods = new Map<string, number>()
  let payments = 0
  for (const x of paid) {
    if (!x.main.live) continue
    payments += 1
    const m = x.main.row ? methodText(x.main.row.method, null, ctx.text) : methodText(methodOfProvider(x.main.input.providerId), null, ctx.text)
    methods.set(m, (methods.get(m) ?? 0) + 1)
  }
  const mostly = [...methods.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  const calm = worst.worst.state === "ok" || worst.worst.state === "none"
  const title: MessageDraft = calm
    ? { key: "integration.customer.payments", params: { count: payments } }
    : { key: "integration.customer.order", params: { order: ref(worst.o), line: ctx.text(worst.worst.title) } }
  const detail: MessageDraft | undefined = ctx.mode === "demo" ? { key: "integration.customer.demo" } : mostly ? { key: "integration.customer.mostly", params: { method: mostly } } : undefined
  const admin = adminLink(ref(calm ? paid[0].o : worst.o))
  const facts: FactDraft[] = mostly
    ? [{ slot: "payment", priority: 80, value: { key: "integration.fact.method", params: { method: mostly } }, sub: { key: "integration.fact.payments", params: { count: payments } }, link: admin }]
    : []
  const all = paid.flatMap((x) => x.lines)
  return {
    state: worst.worst.state,
    title,
    ...(detail ? { detail } : {}),
    facts,
    counts: { orders: paid.length, payments, disputes: all.reduce((n, l) => n + (l.input.read?.disputes.filter((d) => d.open).length ?? 0), 0) },
    links: [admin],
    widget: null,
    updatedAt: newest(all),
    stale: all.some((l) => l.stale),
  }
}

export interface CounterInput {
  /** From the snapshot (null: nothing read yet, the counters are left out rather than called zero). */
  orders: { paymentsFailed: number; paymentsFailedOrders: string[]; disputesOpen: number; disputeOrders: string[] } | null
  /** Checks with the verdict fail (null: not checked yet). */
  checksFailing: number | null
}

/** Board counters, each with the plugin page filtered to what it counts. */
export function stripeCounters(input: CounterInput): CounterDraft[] {
  const out: CounterDraft[] = []
  if (input.orders) {
    out.push({ key: "payments_failed", scope: "orders", count: input.orders.paymentsFailed, tone: "red", link: { kind: "admin", href: "/stripe?filter=attention" }, entity: "order", ids: input.orders.paymentsFailedOrders.slice(0, 20) })
    out.push({ key: "disputes_open", scope: "orders", count: input.orders.disputesOpen, tone: "red", link: { kind: "admin", href: "/stripe?filter=disputed" }, entity: "order", ids: input.orders.disputeOrders.slice(0, 20) })
  }
  if (input.checksFailing !== null) out.push({ key: "health_failing", scope: "integration", count: input.checksFailing, tone: "orange", link: { kind: "admin", href: "/stripe?filter=checks" } })
  return out
}
