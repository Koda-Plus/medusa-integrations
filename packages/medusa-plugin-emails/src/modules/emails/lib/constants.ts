/**
 * Constants of the e-mails module. ZERO IMPORTS on purpose: this file is
 * loaded by the unit tests through `node --test` with type stripping, without
 * a build.
 */

/** Container key of the module service, and the namespace of files, tables and admin strings. */
export const EMAILS_MODULE = "emails"

/**
 * `static identifier` of the notification provider. Medusa keys the
 * registration by this name and the `id` given in medusa-config.ts, so a
 * distinctive name never collides with another Resend provider.
 */
export const PROVIDER_IDENTIFIER = "koda-emails"

export const PLUGIN_VERSION = "0.1.0"

export const MESSAGE_TABLE = "emails_message"
export const SETTING_TABLE = "emails_setting"

/** Languages of the built-in templates. */
export const LOCALES = ["en", "pl"] as const
export type EmailLocale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is EmailLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/** The Koda Plus look when nothing is configured: malachite on Young Night. */
export const DEFAULT_ACCENT = "#26D07C"
export const DEFAULT_HEADER = "#212721"

/** Resend: base URL of the send endpoint. */
export const RESEND_EMAILS_URL = "https://api.resend.com/emails"

/**
 * Resend allows 10 requests per second per team. Five per process leaves room
 * for a second Medusa process (server and worker) and for other apps.
 */
export const DEFAULT_REQUESTS_PER_SECOND = 5
export const DEFAULT_TIMEOUT_MS = 15_000
/** Retries of one send inside the same call, only for answers that say "try again". */
export const DEFAULT_MAX_RETRIES = 2
/** The longest wait between two tries of one send, whatever `retry-after` says. */
export const MAX_RETRY_WAIT_MS = 10_000

/**
 * Consecutive temporary failures (timeouts, 5xx, rate limits) after which the
 * process stops retrying for a while: every send still gets its one try, but
 * no extra ones, so an outage of Resend never multiplies the traffic.
 */
export const BREAKER_THRESHOLD = 5
export const BREAKER_COOLDOWN_MS = 60_000

/** A row being sent holds this lease. A crash mid-send leaves it; it expires to `unknown`. */
export const LEASE_MS = 2 * 60 * 1000

/** Resend keeps an idempotency key for 24 hours. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000

/** Settings read from the database are reused this long by every send in the process. */
export const SETTINGS_CACHE_MS = 10_000

/** Changes made in demo mode (branding, switches) are forgotten after a day, so the shared demo stays clean. */
export const DEMO_RESET_MS = 24 * 60 * 60 * 1000

/** The simulated outbox keeps two weeks. */
export const DEMO_KEEP_DAYS = 14

/** The send log keeps a year by default (`logRetentionDays`, 0 keeps everything). */
export const DEFAULT_RETENTION_DAYS = 365

/** Product lines drawn in one e-mail; the rest is summed up in one line ("and 12 more"). */
export const MAX_ITEMS_SHOWN = 30

/** Gmail clips a message above about 102 KB of HTML. The templates stay well below. */
export const GMAIL_CLIP_BYTES = 102_000

/** Rendered bodies are stored for the simulated outbox only, up to this size. */
export const MAX_STORED_BODY_CHARS = 400_000

/** Test sends from the admin: per person, and for the whole store. */
export const TEST_LIMIT_PER_USER = 5
export const TEST_WINDOW_MS = 10 * 60 * 1000
export const TEST_LIMIT_PER_HOUR = 30

/** Medusa's password reset tokens expire after 15 minutes unless the auth module says otherwise. */
export const DEFAULT_RESET_MINUTES = 15

/** Abandoned carts: idle at least this long, at most this old, at most this many e-mails per run. */
export const DEFAULT_ABANDONED_AFTER_HOURS = 24
export const DEFAULT_ABANDONED_MAX_AGE_HOURS = 72
export const DEFAULT_ABANDONED_MAX_PER_RUN = 50

/** Every hour at :20. */
export const ABANDONED_SCHEDULE = "20 * * * *"
/** Every hour at :50: expired leases, the retention of the log, the demo outbox. */
export const HOUSEKEEPING_SCHEDULE = "50 * * * *"

/**
 * Orders carrying one of these metadata keys came from a marketplace that
 * already wrote to the buyer (the Koda Plus Allegro and BaseLinker plugins set
 * `marketplace_order_ref`), so they get no e-mail from the store.
 */
export const DEFAULT_SKIP_ORDER_METADATA_KEYS: readonly string[] = ["marketplace_order_ref"]

/** Keys of the built-in templates. */
export const TEMPLATES = {
  orderPlaced: "order.placed",
  orderShipped: "order.shipped",
  orderCanceled: "order.canceled",
  customerWelcome: "customer.welcome",
  passwordReset: "password.reset",
  cartAbandoned: "cart.abandoned",
  negotiationCountered: "negotiation.countered",
  negotiationAccepted: "negotiation.accepted",
  negotiationRejected: "negotiation.rejected",
} as const

export type BuiltInTemplateKey = (typeof TEMPLATES)[keyof typeof TEMPLATES]

/**
 * Template keys: letters, digits, dots, dashes and underscores, starting with
 * a letter or digit, at most 64 characters ("order.placed", "company.approved").
 */
export const TEMPLATE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function isTemplateKey(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_KEY.test(value)
}
