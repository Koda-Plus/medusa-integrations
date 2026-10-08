/**
 * Stripe answers for the tests (not a test itself: the runner picks up
 * `*.test.ts` only). Every object is invented for the demo store "Koda
 * Supply": ids, amounts and domains are made up and never belonged to a
 * store. Shapes follow Stripe's API version 2024-04-10.
 */
import type {
  RawAccount,
  RawBalanceTransaction,
  RawCharge,
  RawDispute,
  RawEvent,
  RawPaymentIntent,
  RawPaymentMethodConfiguration,
  RawPaymentMethodDomain,
  RawRefund,
  RawWebhookEndpoint,
} from "../src/modules/stripe/lib/stripe-types.ts"

export const NOW = new Date("2026-10-07T12:00:00Z")
export const sec = (d: Date | number) => Math.floor((typeof d === "number" ? d : d.getTime()) / 1000)
export const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
export const daysAgo = (d: number) => hoursAgo(d * 24)

/** A fake key with the right shape; never a real one. */
export const READ_KEY = "rk_live_TESTONLY1234"

let seq = 0
const next = (prefix: string) => `${prefix}_Fixture${String(++seq).padStart(6, "0")}`

export function bt(amount: number, fee: number, currency = "pln", over: Partial<RawBalanceTransaction> = {}): RawBalanceTransaction {
  return {
    id: next("txn"),
    amount,
    fee,
    net: amount - fee,
    currency,
    exchange_rate: null,
    available_on: sec(NOW) + 86_400,
    status: "pending",
    type: "charge",
    fee_details: [{ amount: fee, currency, description: "Stripe processing fees", type: "stripe_fee" }],
    ...over,
  }
}

export type MethodSpec =
  | { type: "card"; brand?: string; last4?: string; wallet?: string | null }
  | { type: "blik" }
  | { type: "p24"; bank?: string; reference?: string }
  | { type: "link" }
  | { type: string }

export function details(m: MethodSpec): RawCharge["payment_method_details"] {
  if (m.type === "card") {
    const c = m as { brand?: string; last4?: string; wallet?: string | null }
    return { type: "card", card: { brand: c.brand ?? "visa", last4: c.last4 ?? "4242", wallet: c.wallet ? { type: c.wallet } : null } }
  }
  if (m.type === "p24") {
    const p = m as { bank?: string; reference?: string }
    return { type: "p24", p24: { bank: p.bank ?? "pbac_z_ipko", reference: p.reference ?? "P24-ABC-DEF-GHI" } }
  }
  return { type: m.type }
}

export interface PiSpec {
  amount: number
  currency?: string
  created?: Date
  status?: string
  method?: MethodSpec
  fee?: number | null
  sessionId?: string | null
  capture?: "automatic" | "manual"
  automatic?: boolean
  types?: string[]
  refunded?: number
  disputed?: boolean
  risk?: string
  error?: { code?: string; decline_code?: string; message?: string; method?: MethodSpec } | null
  livemode?: boolean
  feeCurrency?: string
}

export function pi(spec: PiSpec): RawPaymentIntent {
  const id = next("pi")
  const currency = spec.currency ?? "pln"
  const status = spec.status ?? "succeeded"
  const succeeded = status === "succeeded"
  const fee = spec.fee === undefined ? Math.round(spec.amount * 0.015) + 100 : spec.fee
  const hasCharge = succeeded || status === "requires_capture" || Boolean(spec.error)
  const charge: RawCharge | null = hasCharge
    ? {
        id: next("ch"),
        amount: spec.amount,
        amount_captured: succeeded ? spec.amount : 0,
        amount_refunded: spec.refunded ?? 0,
        currency,
        created: sec(spec.created ?? NOW),
        status: succeeded ? "succeeded" : spec.error ? "failed" : "pending",
        paid: succeeded,
        captured: succeeded,
        refunded: (spec.refunded ?? 0) >= spec.amount,
        disputed: spec.disputed ?? false,
        outcome: { type: "authorized", risk_level: spec.risk ?? (spec.method?.type === "blik" || spec.method?.type === "p24" ? "not_assessed" : "normal"), risk_score: 20, seller_message: "Payment complete." },
        payment_intent: id,
        payment_method_details: details(spec.method ?? { type: "card" }),
        balance_transaction: succeeded && fee !== null ? bt(spec.amount, fee, spec.feeCurrency ?? currency) : null,
        livemode: spec.livemode ?? true,
      }
    : null
  return {
    id,
    object: "payment_intent",
    amount: spec.amount,
    amount_received: succeeded ? spec.amount : 0,
    currency,
    created: sec(spec.created ?? NOW),
    status,
    capture_method: spec.capture ?? "automatic",
    payment_method_types: spec.types ?? (spec.automatic === false ? [spec.method?.type ?? "card"] : ["card", "blik", "p24", "link"]),
    automatic_payment_methods: { enabled: spec.automatic ?? true },
    metadata: spec.sessionId === null ? {} : { session_id: spec.sessionId ?? next("payses") },
    livemode: spec.livemode ?? true,
    latest_charge: charge,
    last_payment_error: spec.error
      ? {
          code: spec.error.code ?? "card_declined",
          decline_code: spec.error.decline_code ?? null,
          message: spec.error.message ?? "Your card was declined.",
          type: "card_error",
          payment_method: spec.error.method ? { type: spec.error.method.type, card: spec.error.method.type === "card" ? { brand: "mastercard", last4: "4444" } : null } : null,
        }
      : null,
  }
}

export function refund(paymentIntent: RawPaymentIntent, amount: number, over: Partial<RawRefund> = {}): RawRefund {
  return {
    id: next("re"),
    object: "refund",
    amount,
    currency: paymentIntent.currency,
    created: sec(NOW) - 3600,
    status: "succeeded",
    reason: "requested_by_customer",
    failure_reason: null,
    payment_intent: paymentIntent,
    charge: typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge?.id : null,
    ...over,
  }
}

export function dispute(paymentIntent: RawPaymentIntent, over: Partial<RawDispute> & { dueInHours?: number | null } = {}): RawDispute {
  const { dueInHours, ...rest } = over
  return {
    id: next("du"),
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    created: sec(daysAgo(3)),
    status: "needs_response",
    reason: "fraudulent",
    charge: null,
    payment_intent: paymentIntent,
    evidence_details: { due_by: dueInHours === null || dueInHours === undefined ? null : Math.floor(Date.now() / 1000) + dueInHours * 3600, has_evidence: false, past_due: false, submission_count: 0 },
    payment_method_details: { type: "card", card: { brand: "visa" } },
    livemode: true,
    ...rest,
  }
}

export function account(over: Partial<RawAccount> = {}): RawAccount {
  return {
    id: "acct_FixtureKodaSupply",
    country: "PL",
    default_currency: "pln",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: "active", blik_payments: "active", p24_payments: "active" },
    requirements: { currently_due: [], past_due: [], disabled_reason: null, current_deadline: null },
    settings: { dashboard: { display_name: "Koda Supply" } },
    ...over,
  }
}

const on = { available: true, display_preference: { value: "on", preference: "on" } }
const off = { available: false, display_preference: { value: "off", preference: "off" } }

export function methodConfig(overrides: Record<string, "on" | "off"> = {}): RawPaymentMethodConfiguration {
  const entries = Object.fromEntries(["card", "blik", "p24", "apple_pay", "google_pay", "link"].map((m) => [m, (overrides[m] ?? "on") === "on" ? on : off]))
  return { id: "pmc_Fixture", name: "Default", active: true, is_default: true, application: null, parent: null, ...entries }
}

export const HOOK = "https://api.kodasupply.example/hooks/payment/stripe_stripe"
export const ALL_EVENTS = ["payment_intent.succeeded", "payment_intent.amount_capturable_updated", "payment_intent.payment_failed", "payment_intent.partially_funded"]

export function endpoint(over: Partial<RawWebhookEndpoint> = {}): RawWebhookEndpoint {
  return { id: next("we"), url: HOOK, status: "enabled", enabled_events: [...ALL_EVENTS], api_version: "2024-04-10", livemode: true, application: null, ...over }
}

export function event(type: string, created: Date, over: Partial<RawEvent> = {}): RawEvent {
  return { id: next("evt"), type, created: sec(created), pending_webhooks: 1, livemode: true, ...over }
}

export function domain(name: string, over: Partial<RawPaymentMethodDomain> = {}): RawPaymentMethodDomain {
  const active = { status: "active", status_details: null }
  return { id: next("pmd"), domain_name: name, enabled: true, apple_pay: active, google_pay: active, link: active, livemode: true, ...over }
}
