/**
 * Constants of the Stripe module. NO RUNTIME IMPORTS on purpose: the unit
 * tests load this file through `node --test` with type stripping, without a
 * build, and every pure module (and the admin bundle) may read it.
 */
import type { CheckKey, MethodKey } from "./contract"

/**
 * Container key of the module: `container.resolve(STRIPE_MODULE)`.
 *
 * Deliberately not "stripe". The official provider lives inside the payment
 * module as `pp_stripe_<id>`, stores often keep a `stripe` module of their
 * own, and Medusa may one day ship one. A key with our prefix collides with
 * none of them, and the module has no tables and no links, so nothing else
 * carries the name.
 */
export const STRIPE_MODULE = "koda_stripe"

/** The only host the plugin calls. The client has a single method, GET: the plugin cannot move money. */
export const STRIPE_API_BASE = "https://api.stripe.com/v1"

/**
 * Pinned API version: the one the official provider's SDK (stripe-node 15)
 * pins, so the plugin and the provider read the same shapes whatever the
 * account's default version is.
 */
export const STRIPE_API_VERSION = "2024-04-10"

export const DASHBOARD_BASE = "https://dashboard.stripe.com"

/** The `id` of the official provider entry in medusa-config: providers come out as pp_<identifier>_<id>. */
export const DEFAULT_PROVIDER_ID = "stripe"

/** Identifiers of @medusajs/payment-stripe that a Polish store uses (the package registers eight). */
export const PROVIDER_IDENTIFIERS = { card: "stripe", blik: "stripe-blik", p24: "stripe-przelewy24" } as const

/** Reads from Stripe stay cached this long by default (seconds). */
export const DEFAULT_CACHE_SECONDS = 300
export const MIN_CACHE_SECONDS = 30
export const MAX_CACHE_SECONDS = 86_400

/** A forced refresh within this time of the last read is served from the cache. */
export const FORCE_REFRESH_MIN_MS = 30_000

/** A failed read is remembered this long, so a wrong key does not hammer Stripe. */
export const ERROR_CACHE_MS = 60_000

/** Objects per list page (Stripe's maximum). */
export const LIST_LIMIT = 100

/** List pages one read may fetch: 20 pages are 2 000 payments in 30 days. */
export const DEFAULT_MAX_PAGES = 20
export const MAX_MAX_PAGES = 100

/**
 * Self-imposed rate limit. Stripe allows 100 requests a second in live mode
 * and 25 in a sandbox, shared with everything else on the account.
 */
export const DEFAULT_REQUESTS_PER_SECOND = 10
export const MAX_REQUESTS_PER_SECOND = 50

/** Requests in flight at once (list requests with expansions are heavy). */
export const MAX_CONCURRENCY = 4

export const DEFAULT_TIMEOUT_MS = 20_000
export const MIN_TIMEOUT_MS = 2_000
export const MAX_TIMEOUT_MS = 120_000

/**
 * Time budget of one whole read (the snapshot, the checks): past it, no
 * further page and no retry is asked for, and what came in is used with the
 * part that is missing marked. A Stripe outage costs the page this long, not
 * a minute of retries.
 */
export const READ_BUDGET_MS = 25_000

/** Board counters reuse a read this long (seconds), even when `cacheSeconds` is shorter. */
export const COUNTER_MAX_AGE_SECONDS = 900

/** PaymentIntents one summary request may read from Stripe; the rest come from the cache or from Medusa alone. */
export const SUMMARY_READS = 5

/** Retries of one read after a 429, a 5xx or a network error. */
export const MAX_RETRIES = 2

/** Longest wait for a Retry-After before a retry. */
export const MAX_RETRY_WAIT_MS = 10_000

/** The two periods of the panel, in days. One read covers the longer one. */
export const PERIODS = [7, 30] as const
export const WINDOW_DAYS = 30

export const PAYOUTS_LIMIT = 20
export const DISPUTES_LIMIT = 100
/**
 * Disputes are read this far back, page after page: a dispute may come up
 * to 120 days after its payment and stay open for weeks, so an open one is
 * never older than this, whatever the age of its payment.
 */
export const DISPUTES_WINDOW_DAYS = 180
export const DISPUTES_MAX_PAGES = 5
export const RECENT_REFUNDS = 10
export const FIRST_PAGE = 10

/** Session ids looked up in Medusa per query. */
export const SESSION_CHUNK = 200

/**
 * Paid without an order: a succeeded payment created by this Medusa whose
 * cart never became an order. Younger than the grace it may still be on its
 * way (the webhook waits 5 seconds, the customer may still be on the page).
 */
export const ORPHAN_GRACE_MINUTES = 30
export const ORPHAN_WINDOW_DAYS = 7

/** Failed webhook deliveries: the window, and the grace for events Stripe has not tried to deliver yet. */
export const DELIVERY_WINDOW_HOURS = 24
export const DELIVERY_GRACE_MINUTES = 5

/** The event that turns a paid checkout into an order when the customer does not come back. */
export const EVENT_SUCCEEDED = "payment_intent.succeeded"
/** The event of an authorization (capture later). Needed when cards are captured by hand. */
export const EVENT_CAPTURABLE = "payment_intent.amount_capturable_updated"
/** Listed in Medusa's docs as well; Medusa's webhook subscriber ignores them, so they never fail the check. */
export const EVENTS_DOCUMENTED: readonly string[] = ["payment_intent.payment_failed", "payment_intent.partially_funded"]

/** Card in the middle: BLIK leads in Polish stores. Order of the method table when counts tie. */
export const METHOD_KEYS: readonly MethodKey[] = ["blik", "card", "p24", "apple_pay", "google_pay", "link", "other"]

export const CHECK_KEYS: readonly CheckKey[] = ["provider", "key", "account", "capabilities", "webhook", "deliveries", "domains", "regions", "capture", "orphans"]

/** Disputes that still wait for a decision. */
export const OPEN_DISPUTE_STATUSES: readonly string[] = ["warning_needs_response", "needs_response", "warning_under_review", "under_review"]
/** Disputes where the merchant has to answer. */
export const RESPONSE_DISPUTE_STATUSES: readonly string[] = ["warning_needs_response", "needs_response"]

/** Demo mode: payments are built from this many newest orders that qualify (see `demoOrders`). */
export const DEMO_ORDERS = 60

/** Which orders the demo pays with Stripe: only those whose Medusa payment is Stripe's, or also orders with no payment collection at all. */
export const DEMO_ORDER_RULES = ["stripe", "stripe-or-none"] as const

/** Stripe's minimum charge per currency, in minor units (others: 50). An order below it gets no sample payment. */
export const MIN_CHARGE: Readonly<Record<string, number>> = { pln: 200, eur: 50, usd: 50, gbp: 30, chf: 50, czk: 1500, huf: 17500, sek: 300, nok: 300, dkk: 250 }
