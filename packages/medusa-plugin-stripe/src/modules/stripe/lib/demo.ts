/**
 * DEMO MODE: A SAMPLE STRIPE ACCOUNT BUILT FROM THE STORE'S OWN ORDERS.
 * No runtime imports beyond the pure helpers.
 *
 * Lets anyone see the plugin without a Stripe account: the objects below are
 * shaped like Stripe's answers (API version 2024-04-10) and go through the
 * SAME parsers, sums and checks as live data. Nothing calls Stripe, and every
 * row is flagged `demo`.
 *
 * ONLY ORDERS STRIPE WOULD HAVE PAID. The caller passes the orders whose
 * Medusa payment belongs to a Stripe provider (`demoQualifies`, option
 * `demoOrders`): marketplace imports, cash on delivery and other gateways
 * never get a Stripe payment. An order without a total, or below Stripe's
 * minimum charge, gets none either.
 *
 * DETERMINISTIC. The same orders give the same payments: methods, card
 * endings, banks, fees and failures come from a hash of the order id; BLIK
 * and Przelewy24 follow the order's own Stripe provider when it names one.
 * An order of the last 29 days is paid a few minutes before it was placed.
 * For the panel, older orders are moved into the window (the first about an
 * hour before the start of the current hour, the rest at 4 to 18 hour gaps),
 * so both periods have data whatever the age of the store's orders; the
 * order itself (its widget, its summary) always shows the payment dated a
 * few minutes before it was placed, with the refunds and disputes the panel
 * gave it. An order that would land past 30 days is left out of the panel.
 * Within an hour nothing moves.
 *
 * THE STORY:
 *   every order        a succeeded payment: BLIK leads, then cards, Przelewy24,
 *                      Apple Pay, Google Pay and Link (EUR orders: no BLIK)
 *   every 6th order    an earlier attempt that failed and was abandoned
 *   every 9th order    a checkout that was never paid (not an attempt)
 *   one payment        succeeded with no order (the cart was never completed),
 *                      so the "paid without an order" check has something to find
 *   one payment        waiting for the customer to approve BLIK in the bank app
 *   one payment        from outside Medusa (a payment link), without a session
 *   refunds            a partial card refund, a full BLIK refund, a pending
 *                      Przelewy24 refund (they take up to 3 business days)
 *   disputes           a card dispute due in 2 days, a BLIK dispute under
 *                      review, a card dispute won
 *   payouts            per currency, every business day, landing two business
 *                      days later; what became available since the last one
 *                      waits in the available balance
 *   health             a ready Polish account, cards, BLIK and Przelewy24 on,
 *                      the webhook in place, two deliveries still retrying
 *
 * FEES ARE ILLUSTRATIVE (a percentage plus a fixed part per method), not
 * Stripe's price list.
 */
import { EVENT_CAPTURABLE, EVENT_SUCCEEDED, EVENTS_DOCUMENTED, MIN_CHARGE, PAYOUTS_LIMIT, PROVIDER_IDENTIFIERS, STRIPE_API_VERSION } from "./constants"
import type { MethodKey, OrderLinkDto } from "./contract"
import { basisPoints, toMinor } from "./money"
import type {
  RawAccount,
  RawBalance,
  RawBalanceTransaction,
  RawCharge,
  RawDispute,
  RawEvent,
  RawPaymentIntent,
  RawPaymentMethodConfiguration,
  RawPaymentMethodDetails,
  RawPaymentMethodDomain,
  RawPayout,
  RawRefund,
  RawWebhookEndpoint,
} from "./stripe-types"

export interface DemoOrder {
  id: string
  displayId: number | null
  createdAt: string | Date | null
  /** The order total in major units (a number, a string or Medusa's BigNumber). */
  total: unknown
  currency: string
  /** The order's Stripe provider (pp_stripe-blik_stripe...), when its Medusa payment names one: BLIK and Przelewy24 follow it. */
  provider?: string | null
}

/** The payment side of an order as Query returns it: providers only, never metadata. */
export interface DemoPaymentRecord {
  payment_collections?: Array<{
    payments?: Array<{ provider_id?: string | null } | null> | null
    payment_sessions?: Array<{ provider_id?: string | null } | null> | null
  } | null> | null
}

const STRIPE_PROVIDER = /^pp_stripe(-[a-z0-9]+)?_/

/**
 * Whether the demo pays this order with Stripe, from Medusa's own payment
 * records (a shopper cannot set them; metadata is never read):
 *
 *   "stripe"          a payment of the order is a Stripe provider's; with no
 *                     payment yet, a payment session is
 *   "stripe-or-none"  also an order without any payment collection (a demo
 *                     store seeded without a checkout)
 *
 * A marketplace import marked paid (pp_system_default), cash on delivery,
 * another gateway and an unpaid import (a collection without a payment) never
 * qualify.
 */
export function demoQualifies(record: DemoPaymentRecord | null | undefined, rule: "stripe" | "stripe-or-none"): { ok: boolean; provider: string | null } {
  const collections = (record?.payment_collections ?? []).filter((c): c is NonNullable<typeof c> => Boolean(c))
  const payments = collections.flatMap((c) => (c.payments ?? []).map((p) => p?.provider_id).filter((id): id is string => typeof id === "string"))
  const sessions = collections.flatMap((c) => (c.payment_sessions ?? []).map((p) => p?.provider_id).filter((id): id is string => typeof id === "string"))
  const decisive = payments.length > 0 ? payments : sessions
  const stripe = decisive.find((id) => STRIPE_PROVIDER.test(id)) ?? null
  if (stripe) return { ok: true, provider: stripe }
  return { ok: rule === "stripe-or-none" && collections.length === 0, provider: null }
}

/** BLIK and Przelewy24 have providers of their own; the card provider (Payment Element) leaves the method to the hash. */
export function methodOfProvider(provider: string | null | undefined): MethodKey | null {
  if (typeof provider !== "string") return null
  if (provider.startsWith(`pp_${PROVIDER_IDENTIFIERS.blik}_`)) return "blik"
  if (provider.startsWith(`pp_${PROVIDER_IDENTIFIERS.p24}_`)) return "p24"
  return null
}

export interface DemoRegion {
  id: string
  name: string | null
  currency: string
}

export interface DemoInput {
  orders: DemoOrder[]
  now: Date
  providerId: string
  /** Where the sample webhook endpoint points (this backend's hook URL). */
  webhookUrl: string | null
  storefrontDomains: string[]
  regions: DemoRegion[]
}

export interface DemoSession {
  order: OrderLinkDto | null
  cartId: string | null
}

export interface DemoData {
  paymentIntents: RawPaymentIntent[]
  refunds: RawRefund[]
  disputes: RawDispute[]
  balance: RawBalance
  payouts: RawPayout[]
  account: RawAccount
  methodConfigs: RawPaymentMethodConfiguration[]
  endpoints: RawWebhookEndpoint[]
  failedEvents: RawEvent[]
  domains: RawPaymentMethodDomain[]
  providers: Array<{ id: string; isEnabled: boolean }>
  regions: Array<{ id: string; name: string | null; currency: string; providers: string[] }>
  /** Medusa payment session id to its order, or to its cart when it has none. */
  sessions: Map<string, DemoSession>
  /** Order id to the id of its sample PaymentIntent. */
  paymentOfOrder: Map<string, string>
  /** Orders whose payment the panel moved into the 30 days: the order itself shows it at its own date. */
  moved: Set<string>
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const DEMO_ACCOUNT_NAME = "Koda Supply"

/** FNV-1a, 32 bit: a stable number for a string. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** A stable fraction in [0, 1) for a seed. */
export function unit(seed: string): number {
  return hash32(seed) / 0x1_0000_0000
}

/** A Stripe-shaped id that says it is a sample: pi_Demo3k9x... */
export function demoId(prefix: string, seed: string): string {
  const a = hash32(`${seed}:a`).toString(36)
  const b = hash32(`${seed}:b`).toString(36)
  return `${prefix}_Demo${`${a}${b}`.padEnd(14, "0").slice(0, 14)}`
}

const METHODS_PLN: Array<[MethodKey, number]> = [
  ["blik", 0.36],
  ["card", 0.58],
  ["p24", 0.71],
  ["apple_pay", 0.83],
  ["google_pay", 0.94],
  ["link", 1],
]
const METHODS_EUR: Array<[MethodKey, number]> = [
  ["card", 0.45],
  ["apple_pay", 0.65],
  ["google_pay", 0.8],
  ["p24", 0.9],
  ["link", 1],
]
const METHODS_OTHER: Array<[MethodKey, number]> = [
  ["card", 0.6],
  ["apple_pay", 0.8],
  ["google_pay", 1],
]

export function demoMethod(currency: string, seed: string): MethodKey {
  const table = currency === "pln" ? METHODS_PLN : currency === "eur" ? METHODS_EUR : METHODS_OTHER
  const u = unit(`${seed}:method`)
  return (table.find(([, limit]) => u < limit) ?? table[table.length - 1])[0]
}

/** Illustrative fees in basis points plus a fixed part in minor units. Not Stripe's price list. */
const FEES: Record<MethodKey, { bps: number; fixed: number }> = {
  card: { bps: 150, fixed: 100 },
  apple_pay: { bps: 150, fixed: 100 },
  google_pay: { bps: 150, fixed: 100 },
  link: { bps: 150, fixed: 100 },
  blik: { bps: 160, fixed: 100 },
  p24: { bps: 220, fixed: 100 },
  other: { bps: 200, fixed: 100 },
}

export function demoFee(amount: number, currency: string, method: MethodKey): number {
  const f = FEES[method]
  const fixed = currency === "pln" ? f.fixed : currency === "eur" ? 25 : 30
  return Math.min(amount, basisPoints(amount, f.bps) + fixed)
}

const VISA = ["4242", "1881", "0077", "3155"]
const MASTERCARD = ["4444", "5454", "8210", "0005"]
const BANKS = ["pbac_z_ipko", "mbank_mtransfer", "ing", "santander_przelew24", "bank_pekao_sa", "alior_bank", "bank_millennium", "credit_agricole"]

function pick<T>(list: readonly T[], seed: string): T {
  return list[Math.floor(unit(seed) * list.length) % list.length]
}

function p24Reference(seed: string): string {
  const part = (s: string) => hash32(`${seed}:${s}`).toString(36).toUpperCase().padStart(3, "0").slice(-3)
  return `P24-${part("a")}-${part("b")}-${part("c")}`
}

function details(method: MethodKey, seed: string): RawPaymentMethodDetails {
  const card = (wallet: string | null) => {
    const visa = unit(`${seed}:brand`) < 0.6
    return {
      type: "card",
      card: { brand: visa ? "visa" : "mastercard", last4: pick(visa ? VISA : MASTERCARD, `${seed}:last4`), funding: "debit", country: "PL", wallet: wallet ? { type: wallet } : null },
    }
  }
  switch (method) {
    case "blik":
      return { type: "blik", blik: {} }
    case "p24":
      return { type: "p24", p24: { bank: pick(BANKS, `${seed}:bank`), reference: p24Reference(seed) } }
    case "apple_pay":
      return card("apple_pay")
    case "google_pay":
      return card("google_pay")
    case "link":
      return { type: "link", link: {} }
    case "other":
      return { type: "klarna" }
    default:
      return card(null)
  }
}

function typesFor(currency: string): string[] {
  return currency === "pln" ? ["card", "blik", "p24", "link"] : currency === "eur" ? ["card", "p24", "link"] : ["card", "link"]
}

const sec = (ms: number) => Math.floor(ms / 1000)

interface PaymentSpec {
  seed: string
  amount: number
  currency: string
  createdMs: number
  method: MethodKey
  status: "succeeded" | "failed" | "incomplete" | "requires_action"
  sessionId: string | null
  description?: string
}

function balanceTransaction(spec: PaymentSpec, nowMs: number): RawBalanceTransaction {
  const fee = demoFee(spec.amount, spec.currency, spec.method)
  /* Funds become available at the start of the second day after the payment (a date, as Stripe gives it). */
  const availableMs = startOfUtcDay(spec.createdMs) + 2 * DAY
  return {
    id: demoId("txn", spec.seed),
    amount: spec.amount,
    fee,
    net: spec.amount - fee,
    currency: spec.currency,
    exchange_rate: null,
    available_on: sec(availableMs),
    status: availableMs <= nowMs ? "available" : "pending",
    type: "charge",
    fee_details: [{ amount: fee, currency: spec.currency, description: "Stripe processing fees", type: "stripe_fee" }],
  }
}

function riskOf(method: MethodKey, seed: string): { level: string; score: number | null } {
  if (method === "blik" || method === "p24") return { level: "not_assessed", score: null }
  const u = unit(`${seed}:risk`)
  if (u > 0.95) return { level: "elevated", score: 66 + Math.floor(u * 10) }
  return { level: "normal", score: 8 + Math.floor(u * 30) }
}

function paymentIntent(spec: PaymentSpec, nowMs: number): RawPaymentIntent {
  const id = demoId("pi", spec.seed)
  const created = sec(spec.createdMs)
  const succeeded = spec.status === "succeeded"
  const failed = spec.status === "failed"
  const risk = riskOf(spec.method, spec.seed)
  const charge: RawCharge | null =
    succeeded || failed
      ? {
          id: demoId("ch", spec.seed),
          object: "charge",
          amount: spec.amount,
          amount_captured: succeeded ? spec.amount : 0,
          amount_refunded: 0,
          currency: spec.currency,
          created,
          status: succeeded ? "succeeded" : "failed",
          paid: succeeded,
          captured: succeeded,
          refunded: false,
          disputed: false,
          failure_code: failed ? (spec.method === "card" ? "card_declined" : "payment_method_provider_decline") : null,
          failure_message: failed ? (spec.method === "card" ? "Your card has insufficient funds." : "The customer declined the payment in their banking app.") : null,
          outcome: succeeded
            ? { type: "authorized", risk_level: risk.level, risk_score: risk.score, seller_message: "Payment complete.", network_status: "approved_by_network", reason: null }
            : { type: "issuer_declined", risk_level: risk.level, risk_score: risk.score, seller_message: "The bank declined the payment.", network_status: "declined_by_network", reason: spec.method === "card" ? "insufficient_funds" : "generic_decline" },
          payment_intent: id,
          payment_method_details: details(spec.method, spec.seed),
          balance_transaction: succeeded ? balanceTransaction(spec, nowMs) : null,
          refunds: { object: "list", data: [], has_more: false },
          livemode: true,
        }
      : null
  return {
    id,
    object: "payment_intent",
    amount: spec.amount,
    amount_received: succeeded ? spec.amount : 0,
    amount_capturable: 0,
    currency: spec.currency,
    created,
    status: succeeded ? "succeeded" : spec.status === "requires_action" ? "requires_action" : "requires_payment_method",
    capture_method: "automatic",
    payment_method_types: spec.sessionId ? typesFor(spec.currency) : ["card"],
    automatic_payment_methods: { enabled: Boolean(spec.sessionId) },
    metadata: spec.sessionId ? { session_id: spec.sessionId } : {},
    livemode: true,
    canceled_at: null,
    cancellation_reason: null,
    latest_charge: charge,
    payment_method: spec.status === "requires_action" ? { id: demoId("pm", spec.seed), type: spec.method } : null,
    last_payment_error: failed
      ? {
          code: spec.method === "card" ? "card_declined" : "payment_method_provider_decline",
          decline_code: spec.method === "card" ? "insufficient_funds" : null,
          message: spec.method === "card" ? "Your card has insufficient funds." : "The customer declined the payment in their banking app.",
          type: "card_error",
          payment_method: { id: demoId("pm", spec.seed), type: details(spec.method, spec.seed).type ?? spec.method, card: details(spec.method, spec.seed).card ?? null },
        }
      : null,
  }
}

function created(order: DemoOrder): number {
  const t = order.createdAt instanceof Date ? order.createdAt.getTime() : Date.parse(String(order.createdAt ?? ""))
  return Number.isFinite(t) ? t : 0
}

/** The order total in minor units, or null without a total or below Stripe's minimum charge: such an order gets no sample payment. */
export function demoAmount(order: Pick<DemoOrder, "total" | "currency">): number | null {
  const currency = String(order.currency || "pln").toLowerCase()
  const minor = toMinor(order.total, currency)
  if (minor === null) return null
  return minor >= (MIN_CHARGE[currency] ?? 50) ? minor : null
}

function methodFor(order: DemoOrder, currency: string): MethodKey {
  return methodOfProvider(order.provider) ?? demoMethod(currency, order.id)
}

/** Monday to Friday, in UTC. */
function businessDay(ms: number): boolean {
  const d = new Date(ms).getUTCDay()
  return d !== 0 && d !== 6
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function addBusinessDays(ms: number, days: number): number {
  let at = ms
  for (let n = 0; n < days; ) {
    at += DAY
    if (businessDay(at)) n++
  }
  return at
}

export function buildDemoData(input: DemoInput): DemoData {
  const anchor = Math.floor(input.now.getTime() / HOUR) * HOUR
  const nowMs = input.now.getTime()
  const orders = [...input.orders]
    .filter((o) => o && typeof o.id === "string" && o.id)
    .sort((a, b) => created(b) - created(a) || (a.id < b.id ? 1 : -1))

  const sessions = new Map<string, DemoSession>()
  const paymentOfOrder = new Map<string, string>()
  const moved = new Set<string>()
  const specs: PaymentSpec[] = []
  /* Fixed within the hour, so an order on the edge does not flip between its own date and a moved one. */
  const recentFrom = anchor - 29 * DAY
  const oldest = anchor - 30 * DAY + HOUR
  let cursor = anchor - HOUR + Math.floor(unit("first") * 20) * 60_000

  const payable = orders.filter((o) => demoAmount(o) !== null)
  payable.forEach((order, i) => {
    /* An order of the last 29 days is paid a few minutes before it was placed; older ones are moved into the window. */
    const real = created(order)
    let at: number
    if (real >= recentFrom && real <= nowMs) {
      at = paidAt(order, real)
      cursor = Math.min(cursor, at)
    } else {
      if (i > 0) cursor -= 4 * HOUR + Math.floor(unit(`${order.id}:gap`) * 14 * HOUR)
      at = cursor
      /* Past the 30 days the panel reads: the order widget builds this order's payment on its own. */
      if (at < oldest) return
      moved.add(order.id)
    }
    const currency = String(order.currency || "pln").toLowerCase()
    const amount = demoAmount(order) as number
    const method = methodFor(order, currency)
    const sessionId = demoId("payses", order.id)
    sessions.set(sessionId, { order: { id: order.id, displayId: order.displayId }, cartId: null })
    const spec: PaymentSpec = { seed: order.id, amount, currency, createdMs: at, method, status: "succeeded", sessionId }
    specs.push(spec)
    paymentOfOrder.set(order.id, demoId("pi", order.id))

    if (i % 6 === 2) {
      /* An earlier checkout of a similar basket that failed and was abandoned. */
      const seed = `${order.id}:failed`
      const failedSession = demoId("payses", seed)
      sessions.set(failedSession, { order: null, cartId: demoId("cart", seed) })
      specs.push({ seed, amount, currency, createdMs: at - 25 * 60_000, method: currency === "pln" && unit(seed) < 0.5 ? "blik" : "card", status: "failed", sessionId: failedSession })
    }
    if (i % 9 === 4) {
      const seed = `${order.id}:abandoned`
      const abandoned = demoId("payses", seed)
      sessions.set(abandoned, { order: null, cartId: demoId("cart", seed) })
      specs.push({ seed, amount: Math.max(500, Math.round(amount / 2)), currency, createdMs: at - 3 * HOUR, method, status: "incomplete", sessionId: abandoned })
    }
  })

  /* Paid, and the cart never became an order: the orphan the health check finds. */
  const base = specs.find((s) => s.status === "succeeded")?.amount ?? 18_900
  const orphanSeed = "orphan"
  const orphanSession = demoId("payses", orphanSeed)
  sessions.set(orphanSession, { order: null, cartId: demoId("cart", orphanSeed) })
  specs.push({ seed: orphanSeed, amount: Math.max(1_000, Math.round(base * 0.37)), currency: "pln", createdMs: anchor - 3 * HOUR - 12 * 60_000, method: "blik", status: "succeeded", sessionId: orphanSession })

  /* Waiting for the customer to approve BLIK in the bank app, a moment ago. */
  const waitingSeed = "waiting"
  const waitingSession = demoId("payses", waitingSeed)
  sessions.set(waitingSession, { order: null, cartId: demoId("cart", waitingSeed) })
  specs.push({ seed: waitingSeed, amount: 12_900, currency: "pln", createdMs: nowMs - 90_000, method: "blik", status: "requires_action", sessionId: waitingSession })

  /* A payment link paid outside Medusa: no session, shown as "not from Medusa". */
  specs.push({ seed: "payment-link", amount: 35_000, currency: "pln", createdMs: anchor - 5 * DAY - 7 * HOUR, method: "card", status: "succeeded", sessionId: null, description: "Payment link" })

  const paymentIntents = specs.map((s) => paymentIntent(s, nowMs)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  const byId = new Map(paymentIntents.map((p) => [String(p.id), p]))
  const orderPayments = specs
    .filter((s) => s.status === "succeeded" && s.sessionId && sessions.get(s.sessionId)?.order)
    .map((s) => byId.get(demoId("pi", s.seed)))
    .filter((p): p is RawPaymentIntent => Boolean(p))
  const methodOf = (pi: RawPaymentIntent) => {
    const c = pi.latest_charge as RawCharge
    const t = c?.payment_method_details?.type
    return t === "card" ? (c.payment_method_details?.card?.wallet?.type ? "wallet" : "card") : String(t)
  }
  const chargeOf = (pi: RawPaymentIntent) => pi.latest_charge as RawCharge
  /* The newest payment of the kind that is old enough; a small store takes what it has. */
  const take = (want: (pi: RawPaymentIntent) => boolean, skip: Set<string>, minAgeDays: number): RawPaymentIntent | null => {
    const free = orderPayments.filter((p) => !skip.has(String(p.id)) && want(p))
    return free.find((p) => (p.created ?? 0) * 1000 <= nowMs - minAgeDays * DAY) ?? free[free.length - 1] ?? null
  }

  /* Refunds: partial card, full BLIK, pending Przelewy24. */
  const used = new Set<string>()
  const refunds: RawRefund[] = []
  const refund = (pi: RawPaymentIntent | null, share: number, status: string, afterDays: number, seed: string) => {
    if (!pi) return
    used.add(String(pi.id))
    const charge = chargeOf(pi)
    const amount = share >= 1 ? Number(pi.amount) : Math.max(100, Math.round(Number(pi.amount) * share))
    const createdS = Math.min(sec(nowMs - HOUR), (pi.created ?? 0) + Math.round(afterDays * 86_400))
    charge.amount_refunded = amount
    charge.refunded = share >= 1
    const r: RawRefund = { id: demoId("re", seed), object: "refund", amount, currency: pi.currency, created: createdS, status, reason: "requested_by_customer", failure_reason: null, payment_intent: pi, charge: charge.id }
    charge.refunds = { object: "list", data: [{ ...r, payment_intent: pi.id }], has_more: false }
    refunds.push(r)
  }
  refund(take((p) => methodOf(p) === "card", used, 3), 0.3, "succeeded", 1.2, "refund-card")
  refund(take((p) => methodOf(p) === "blik", used, 6), 1, "succeeded", 2, "refund-blik")
  refund(take((p) => methodOf(p) === "p24", used, 1.2), 1, "pending", 1, "refund-p24")

  /* Disputes: card due in 2 days, BLIK under review, card won. */
  const disputes: RawDispute[] = []
  const dispute = (pi: RawPaymentIntent | null, seed: string, args: { status: string; reason: string; afterDays: number; dueInDays: number | null; evidence: boolean }) => {
    if (!pi) return
    used.add(String(pi.id))
    const charge = chargeOf(pi)
    charge.disputed = true
    const createdS = Math.min(sec(nowMs - 2 * HOUR), (pi.created ?? 0) + Math.round(args.afterDays * 86_400))
    disputes.push({
      id: demoId("du", seed),
      amount: pi.amount,
      currency: pi.currency,
      created: createdS,
      status: args.status,
      reason: args.reason,
      charge: charge.id,
      payment_intent: pi,
      is_charge_refundable: false,
      evidence_details: {
        due_by: args.dueInDays === null ? createdS + 12 * 86_400 : sec(nowMs + args.dueInDays * DAY),
        has_evidence: args.evidence,
        past_due: false,
        submission_count: args.evidence ? 1 : 0,
      },
      payment_method_details: { type: charge.payment_method_details?.type ?? null, card: charge.payment_method_details?.card ? { brand: charge.payment_method_details.card.brand ?? null } : null },
      livemode: true,
    })
  }
  dispute(take((p) => methodOf(p) === "card" || methodOf(p) === "wallet", used, 6), "dispute-open", { status: "needs_response", reason: "fraudulent", afterDays: 4, dueInDays: 2, evidence: false })
  dispute(take((p) => methodOf(p) === "blik", used, 9), "dispute-review", { status: "under_review", reason: "product_not_received", afterDays: 3, dueInDays: null, evidence: true })
  dispute(take((p) => methodOf(p) === "card" || methodOf(p) === "wallet", used, 12), "dispute-won", { status: "won", reason: "duplicate", afterDays: 2, dueInDays: null, evidence: true })

  /*
   * Payouts, per currency: every business day pays out what became available
   * up to that day, refunds come off the same pot, and the money lands two
   * business days later. What became available since the last payout (today,
   * or over a weekend) waits in the available balance; what is not available
   * yet is pending.
   */
  const today = startOfUtcDay(nowMs)
  const moves = new Map<string, Array<{ at: number; amount: number }>>()
  const pendingBy = new Map<string, number>()
  const move = (currency: string, at: number, amount: number) => moves.set(currency, [...(moves.get(currency) ?? []), { at, amount }])
  for (const p of paymentIntents) {
    if (p.status !== "succeeded") continue
    const bt = (p.latest_charge as RawCharge).balance_transaction as RawBalanceTransaction
    const at = (bt.available_on ?? 0) * 1000
    const currency = String(bt.currency)
    if (at > nowMs) pendingBy.set(currency, (pendingBy.get(currency) ?? 0) + Number(bt.net))
    else move(currency, at, Number(bt.net))
  }
  /* A refund leaves the balance when it is made, also while it is still pending. */
  for (const r of refunds) if (r.status === "succeeded" || r.status === "pending") move(String(r.currency), (r.created ?? 0) * 1000, -Number(r.amount))

  const payouts: RawPayout[] = []
  const availableBy = new Map<string, number>()
  for (const [currency, list] of moves) {
    list.sort((a, b) => a.at - b.at)
    let carry = 0
    let next = 0
    for (let day = startOfUtcDay(list[0].at); day < today; day += DAY) {
      while (next < list.length && list[next].at <= day) carry += list[next++].amount
      if (!businessDay(day) || carry <= 0) continue
      const arrival = addBusinessDays(day, 2)
      payouts.push({
        id: demoId("po", `payout:${currency}:${day}`),
        amount: carry,
        currency,
        created: sec(day + 2 * HOUR),
        arrival_date: sec(arrival),
        status: arrival + 10 * HOUR <= nowMs ? "paid" : "in_transit",
        method: "standard",
        automatic: true,
        failure_message: null,
        failure_code: null,
      })
      carry = 0
    }
    while (next < list.length) carry += list[next++].amount
    availableBy.set(currency, Math.max(0, carry))
  }
  /* As Stripe lists them: the newest first, as many as the panel reads. */
  payouts.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || String(a.currency).localeCompare(String(b.currency)))
  payouts.splice(PAYOUTS_LIMIT)

  const currencies = [...new Set(["pln", ...availableBy.keys(), ...pendingBy.keys()])]
  const balance: RawBalance = {
    available: currencies.map((currency) => ({ amount: availableBy.get(currency) ?? 0, currency })),
    pending: currencies.map((currency) => ({ amount: pendingBy.get(currency) ?? 0, currency })),
    livemode: true,
  }

  /* Health: a ready Polish account. */
  const account: RawAccount = {
    id: "acct_DemoKodaSupply",
    country: "PL",
    default_currency: "pln",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: "active", blik_payments: "active", p24_payments: "active", link_payments: "active", transfers: "active" },
    requirements: { currently_due: [], past_due: [], disabled_reason: null, current_deadline: null },
    settings: { dashboard: { display_name: DEMO_ACCOUNT_NAME }, payouts: { schedule: { interval: "daily", delay_days: 2 } } },
    business_profile: { name: DEMO_ACCOUNT_NAME },
  }
  const on = { available: true, display_preference: { value: "on", preference: "on" } }
  const methodConfigs: RawPaymentMethodConfiguration[] = [
    { id: "pmc_DemoDefault", name: "Default", active: true, is_default: true, application: null, parent: null, card: on, blik: on, p24: on, apple_pay: on, google_pay: on, link: on },
  ]
  const endpoints: RawWebhookEndpoint[] = input.webhookUrl
    ? [
        {
          id: "we_DemoMedusa",
          url: input.webhookUrl,
          status: "enabled",
          enabled_events: [EVENT_SUCCEEDED, EVENT_CAPTURABLE, ...EVENTS_DOCUMENTED],
          api_version: STRIPE_API_VERSION,
          description: "Medusa",
          application: null,
          livemode: true,
        },
      ]
    : []
  const failedEvents: RawEvent[] = [40, 95].map((minutes, i) => ({
    id: demoId("evt", `retry:${i}`),
    type: "payment_intent.payment_failed",
    created: sec(nowMs - minutes * 60_000),
    pending_webhooks: 1,
    livemode: true,
    data: { object: { id: paymentIntents.find((p) => p.status === "requires_payment_method")?.id ?? null, object: "payment_intent" } },
  }))
  const domainNames = input.storefrontDomains.length > 0 ? input.storefrontDomains : ["shop.example"]
  const active = { status: "active", status_details: null }
  const domains: RawPaymentMethodDomain[] = domainNames.map((name, i) => ({ id: demoId("pmd", `domain:${i}`), domain_name: name, enabled: true, apple_pay: active, google_pay: active, link: active, livemode: true }))

  /* Medusa's side, simulated: the official provider registered, the card provider in every region. */
  const ids = {
    card: `pp_${PROVIDER_IDENTIFIERS.card}_${input.providerId}`,
    blik: `pp_${PROVIDER_IDENTIFIERS.blik}_${input.providerId}`,
    p24: `pp_${PROVIDER_IDENTIFIERS.p24}_${input.providerId}`,
  }
  const providers = ["pp_system_default", ids.card, ids.blik, ids.p24].map((id) => ({ id, isEnabled: true }))
  const realRegions = input.regions.filter((r) => r && r.id)
  const regionList = realRegions.some((r) => r.currency === "pln") ? realRegions : [{ id: "reg_DemoPolska", name: "Polska", currency: "pln" }, ...realRegions]
  const regions = regionList.map((r) => ({ id: r.id, name: r.name, currency: String(r.currency).toLowerCase(), providers: ["pp_system_default", ids.card] }))

  return { paymentIntents, refunds, disputes, balance, payouts, account, methodConfigs, endpoints, failedEvents, domains, providers, regions, sessions, paymentOfOrder, moved }
}

/** A few minutes before the order was placed, the same for the panel and the order. */
function paidAt(order: DemoOrder, real: number): number {
  return real - (1 + Math.floor(unit(`${order.id}:pay`) * 4)) * 60_000
}

/**
 * The sample PaymentIntent of one order for the order widget and its summary,
 * always dated a few minutes before the order: the one the panel shows when
 * the panel kept the order's own date, otherwise the same payment built at
 * the order's date, with the refunds and the dispute flag the panel gave it
 * (a dispute or a refund weeks after a payment is ordinary). Null for an
 * order without a total or below Stripe's minimum.
 */
export function demoPaymentForOrder(data: DemoData, order: DemoOrder, now: Date): { pi: RawPaymentIntent; sessions: Map<string, DemoSession> } | null {
  const id = data.paymentOfOrder.get(order.id)
  const known = id ? data.paymentIntents.find((p) => p.id === id) : undefined
  if (known && !data.moved.has(order.id)) return { pi: known, sessions: data.sessions }
  const amount = demoAmount(order)
  if (amount === null) return null
  const currency = String(order.currency || "pln").toLowerCase()
  const sessionId = demoId("payses", order.id)
  const at = created(order) || now.getTime() - DAY
  const pi = paymentIntent({ seed: order.id, amount, currency, createdMs: paidAt(order, at), method: methodFor(order, currency), status: "succeeded", sessionId }, now.getTime())
  const was = known?.latest_charge && typeof known.latest_charge === "object" ? (known.latest_charge as RawCharge) : null
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? (pi.latest_charge as RawCharge) : null
  if (was && charge) {
    charge.amount_refunded = was.amount_refunded
    charge.refunded = was.refunded
    charge.refunds = was.refunds
    charge.disputed = was.disputed
  }
  return { pi, sessions: new Map([[sessionId, { order: { id: order.id, displayId: order.displayId }, cartId: null }]]) }
}
