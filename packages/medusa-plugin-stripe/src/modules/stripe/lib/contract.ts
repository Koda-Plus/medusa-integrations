/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. No runtime imports: the
 * admin bundle imports these types, Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. The API key stays in the module; the
 * admin gets its kind, its mode and its last four characters. A payment's
 * `client_secret` never leaves the server either.
 *
 * MONEY IS AN INTEGER IN THE CURRENCY'S MINOR UNIT (grosze for PLN), exactly
 * as Stripe sends it, with the currency in lower case. Sums are integer sums
 * per currency; amounts in two currencies are never added together.
 */

export type StripeMode = "demo" | "live" | "test" | "unconfigured"

export type MethodKey = "blik" | "card" | "p24" | "apple_pay" | "google_pay" | "link" | "other"

export type CheckKey = "provider" | "key" | "account" | "capabilities" | "webhook" | "deliveries" | "domains" | "regions" | "capture" | "orphans"

/** pass: fine. warn: works, but something is off. fail: costs money or orders now. info: worth knowing. off: turned off in the options. unknown: could not be read. */
export type Verdict = "pass" | "warn" | "fail" | "info" | "off" | "unknown"

/**
 * A PaymentIntent in one word:
 *   succeeded        the money is in
 *   processing       the customer approved, the bank has not confirmed yet
 *   authorized       held on the card, waiting for the capture in Medusa
 *   requires_action  waiting for the customer (3D Secure, the BLIK app, the bank page)
 *   failed           the last attempt was declined
 *   canceled         canceled in Medusa or Stripe
 *   incomplete       created at checkout, never paid (an abandoned checkout)
 */
export type PaymentStatus = "succeeded" | "processing" | "authorized" | "requires_action" | "failed" | "canceled" | "incomplete"

/** attention: failed or waiting for the customer. outside: not created by this Medusa. */
export type PaymentFilter = "all" | "succeeded" | "failed" | "refunded" | "disputed" | "attention" | "outside"

/** Radar's evaluation of the charge. Wallet-less bank methods (BLIK, Przelewy24) are `not_assessed`. */
export type RiskLevel = "normal" | "elevated" | "highest" | "not_assessed" | "unknown"

/** overdue: the evidence deadline passed. urgent: under 3 days. soon: under 7. ok: more. waiting: nothing to do (under review, or no deadline). */
export type DisputeUrgency = "overdue" | "urgent" | "soon" | "ok" | "waiting"

export type KeyKind = "restricted" | "secret" | "publishable" | "unknown"

export interface MoneyDto {
  /** Minor units, an integer. */
  amount: number
  /** ISO 4217, lower case, like Stripe: "pln". */
  currency: string
}

export interface LocalizedText {
  en?: string
  pl?: string
}

export interface ReferenceDto {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: a "Soon" badge, no link. */
  soon: boolean
  /** The store's icon: a data URI or an https URL. */
  icon: string | null
  description: LocalizedText | null
  metrics: Array<{ label: LocalizedText; value: string }>
  links: Array<{ label: LocalizedText; url: string }>
  /** The store's rating of the work and where it was given, e.g. Clutch. */
  review: {
    rating: number
    scale: number
    source: string
    url: string | null
    icon: string | null
    quote: LocalizedText | null
    author: string | null
  } | null
}

/** The Medusa order a payment belongs to. */
export interface OrderLinkDto {
  id: string
  displayId: number | null
}

/** What Stripe says about the way the customer paid. Never a name, an e-mail or a BLIK buyer id. */
export interface MethodDetailDto {
  /** Card brand: visa, mastercard, amex... */
  brand: string | null
  /** The last four digits of the card. */
  last4: string | null
  /** The card's wallet: apple_pay, google_pay, link, samsung_pay... */
  wallet: string | null
  /** Przelewy24: the bank the customer chose (Stripe's enum, like `pbac_z_ipko`). */
  bank: string | null
  /** Przelewy24: the payment reference printed on the bank statement. */
  reference: string | null
  /** The raw Stripe payment method type, for `other`. */
  type: string | null
}

export interface PaymentRowDto {
  /** The PaymentIntent id, pi_... */
  id: string
  created: string
  amount: MoneyDto
  /** What came in (`amount_received`), for a succeeded payment. */
  received: MoneyDto | null
  status: PaymentStatus
  /** Stripe's own status, e.g. `requires_payment_method`. */
  stripeStatus: string
  captureMethod: string | null
  /** How the customer paid, or tried to. Null when no method was chosen yet. */
  method: MethodKey | null
  detail: MethodDetailDto | null
  /** Stripe's fee and the net, from the charge's balance transaction (the settlement currency). */
  fee: MoneyDto | null
  net: MoneyDto | null
  refunded: MoneyDto | null
  disputed: boolean
  risk: RiskLevel | null
  /** The last decline: Stripe's code (a decline code when there is one) and message, in English. */
  failure: { code: string | null; message: string | null } | null
  /** Created by this Medusa (the official provider puts the payment session id in the metadata). */
  fromMedusa: boolean
  order: OrderLinkDto | null
  /** The cart of the payment session when it never became an order. */
  cartId: string | null
  dashboardUrl: string
  demo: boolean
}

export interface MethodStatsDto {
  method: MethodKey
  /** Succeeded payments. */
  count: number
  /** Declined attempts (payments whose last attempt failed). */
  failed: number
  volume: MoneyDto[]
  fees: MoneyDto[]
  net: MoneyDto[]
  /** Succeeded / (succeeded + failed), 0 to 1, null without attempts. */
  successRate: number | null
}

export interface PeriodStatsDto {
  days: number
  from: string
  succeeded: number
  failed: number
  authorized: number
  processing: number
  /** Created at checkout and never paid: not counted in the success rate. */
  incomplete: number
  successRate: number | null
  /** Gross: what customers paid, per presentment currency. */
  volume: MoneyDto[]
  /** Stripe's fees and the net, per settlement currency. */
  fees: MoneyDto[]
  net: MoneyDto[]
  /** Succeeded payments whose fee is not known yet (no balance transaction). */
  feesPending: number
  refunded: MoneyDto[]
  refunds: number
  disputesOpened: number
  methods: MethodStatsDto[]
  /** The read stopped at `maxPages`: the oldest payments of the period are missing. */
  partial: boolean
}

export interface RefundRowDto {
  id: string
  paymentIntent: string | null
  created: string
  amount: MoneyDto
  /** pending, requires_action, succeeded, failed, canceled */
  status: string
  /** duplicate, fraudulent, requested_by_customer, expired_uncaptured_charge */
  reason: string | null
  failureReason: string | null
  order: OrderLinkDto | null
  dashboardUrl: string
  demo: boolean
}

export interface DisputeRowDto {
  id: string
  paymentIntent: string | null
  created: string
  amount: MoneyDto
  /** Stripe's status: needs_response, under_review, won, lost, warning_*. */
  status: string
  open: boolean
  /** fraudulent, product_not_received, duplicate... */
  reason: string | null
  method: MethodKey | null
  /** When the evidence is due, if Stripe set a deadline. */
  dueBy: string | null
  /** Whole days until the deadline (negative once it passed). */
  daysLeft: number | null
  urgency: DisputeUrgency
  hasEvidence: boolean
  submissions: number
  order: OrderLinkDto | null
  dashboardUrl: string
  demo: boolean
}

export interface BalanceDto {
  available: MoneyDto[]
  pending: MoneyDto[]
}

export interface PayoutRowDto {
  id: string
  amount: MoneyDto
  created: string
  arrivalDate: string | null
  /** paid, pending, in_transit, canceled, failed */
  status: string
  /** standard or instant. */
  method: string | null
  automatic: boolean
  failureMessage: string | null
  dashboardUrl: string
  demo: boolean
}

export type SectionKey = "payments" | "refunds" | "disputes" | "balance" | "payouts" | "orders"

/** A part of the read that failed, with the restricted key permission Stripe named, when it named one. */
export interface SectionErrorDto {
  section: SectionKey
  message: string
  status: number | null
  permission: string | null
}

export interface HealthSummaryDto {
  pass: number
  warn: number
  fail: number
  info: number
  off: number
  unknown: number
  worst: Verdict
}

export interface StripeOverviewResponse {
  mode: StripeMode
  configured: boolean
  /** When the data was read from Stripe (or built, in demo mode). Null when nothing could be read. */
  fetchedAt: string | null
  cacheSeconds: number
  /** The answer comes from a read made for this request. */
  fresh: boolean
  periods: PeriodStatsDto[]
  /** The newest payments, first page; the rest through /admin/stripe/payments. */
  payments: PaymentRowDto[]
  paymentsTotal: number
  /** Open disputes, the closest deadline first. */
  disputes: DisputeRowDto[]
  disputesClosed: { won: number; lost: number }
  refunds: RefundRowDto[]
  balance: BalanceDto | null
  payouts: { upcoming: PayoutRowDto[]; past: PayoutRowDto[] }
  errors: SectionErrorDto[]
  dashboardUrl: string
}

export interface StripePaymentsResponse {
  payments: PaymentRowDto[]
  count: number
  offset: number
  limit: number
  fetchedAt: string | null
  counts: Record<PaymentFilter, number>
  methods: Partial<Record<MethodKey, number>>
}

/** A line under a check: an id, a domain, an event name, an amount. Raw values, formatted by the admin. */
export interface CheckItemDto {
  /** A name the admin translates and puts before the label (`checks.term.<term>`): country, currency, charges, payouts. */
  term?: string | null
  /** Raw text: an id, a domain, a URL, an event name, a region name. */
  label?: string | null
  /** A payment method: the admin shows its name. */
  method?: MethodKey | null
  /** A state word the admin translates (`checks.state.<state>`): active, inactive, pending, on, off, enabled, disabled, registered, missing... */
  state?: string | null
  /** Raw secondary text. */
  value?: string | null
  /** A translated note after the state (`checks.note.<key>` with params), e.g. the number of events of an endpoint. */
  note?: { key: string; params: Record<string, string | number> } | null
  money?: MoneyDto | null
  at?: string | null
  url?: string | null
  /** The Medusa order of a payment, for a link. */
  order?: OrderLinkDto | null
  tone?: "green" | "orange" | "red" | "grey" | "blue"
}

export interface CheckResultDto {
  key: CheckKey
  verdict: Verdict
  /** The message: `checks.<key>.<code>` in the admin dictionaries, with `params`. */
  code: string
  params: Record<string, string | number>
  /** How to fix it: `checks.<key>.hint.<hint>`, with the same params. */
  hint: string | null
  /** Where to fix it: a Stripe Dashboard page or a page of this admin. */
  link: { kind: "stripe" | "admin" | "docs"; url: string } | null
  items: CheckItemDto[]
  /** For `unknown`: what failed, masked, and the permission Stripe asked for. */
  error: string | null
  permission: string | null
  demo: boolean
}

export interface StripeChecksResponse {
  mode: StripeMode
  checkedAt: string | null
  fresh: boolean
  /** The webhook URL this backend expects, from `backendUrl` or the address of this admin. */
  webhookUrl: string | null
  results: CheckResultDto[]
  summary: HealthSummaryDto
}

export interface KeyInfoDto {
  kind: KeyKind | null
  mode: "live" | "test" | null
  /** Last four characters, never more. */
  last4: string | null
}

export interface StripeStatusResponse {
  mode: StripeMode
  configured: boolean
  /** Options that keep the plugin from reading Stripe: ["apiKey"]. */
  missing: string[]
  demoReason: "option" | null
  key: KeyInfoDto
  options: {
    providerId: string
    providerIds: { card: string; blik: string; p24: string }
    backendUrl: string | null
    storefrontDomains: string[]
    storefrontSource: "option" | "store_cors" | "none"
    cacheSeconds: number
    maxPages: number
    requestsPerSecond: number
    timeoutMs: number
    checks: Record<CheckKey, boolean>
  }
  apiVersion: string
  webhookPath: string
  /** The webhook URL this backend expects, from `backendUrl` or the address of this admin. */
  webhookUrl: string | null
  dashboardUrl: string
  references: ReferenceDto[]
}

/** One PaymentIntent of an order, for the order widget. */
export interface OrderPaymentDto {
  id: string
  /** The Medusa payment provider, e.g. pp_stripe-blik_stripe. */
  providerId: string | null
  found: boolean
  /** Why it could not be read: not_found (another account or mode), forbidden (a permission), error, unconfigured (no key yet). */
  problem: "not_found" | "forbidden" | "error" | "unconfigured" | null
  problemMessage: string | null
  permission: string | null
  payment: PaymentRowDto | null
  feeDetails: Array<{ type: string; amount: MoneyDto; description: string | null }>
  /** The settlement exchange rate, when Stripe converted the payment. */
  exchangeRate: number | null
  availableOn: string | null
  refunds: RefundRowDto[]
  disputes: DisputeRowDto[]
  outcome: { type: string | null; sellerMessage: string | null; riskScore: number | null } | null
  livemode: boolean | null
}

export interface StripeOrderResponse {
  mode: StripeMode
  configured: boolean
  orderId: string
  payments: OrderPaymentDto[]
  /** The order was not paid with Stripe (no Stripe payment or session). */
  none: boolean
  dashboardUrl: string
}
