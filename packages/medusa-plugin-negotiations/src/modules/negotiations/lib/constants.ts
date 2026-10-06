/**
 * Constants of the Negotiations module. ZERO IMPORTS on purpose: this file is
 * loaded by the unit tests through `node --test` with type stripping, without
 * a build.
 */

/** Container key of the module service. */
export const NEGOTIATIONS_MODULE = "negotiations"

/*
 * TABLE NAMES. `negotiation` and `negotiation_message` keep the names of the
 * app module this plugin was extracted from (the Koda Plus demo store), so a
 * store that ran that module upgrades in place: the migration only adds
 * columns and tables, it never renames or drops one.
 */
export const THREAD_TABLE = "negotiation"
export const MESSAGE_TABLE = "negotiation_message"
export const SETTING_TABLE = "negotiation_setting"
export const RUN_TABLE = "negotiation_run"
export const DRAFT_ORDER_TABLE = "negotiation_draft_order"
/** Postgres sequence behind the readable reference, NEG-2026-1001. */
export const REF_SEQUENCE = "negotiation_ref_seq"
/** The first number of the reference sequence. */
export const REF_START = 1001

/** Thread statuses, the same five as the app module had. */
export const STATUSES = ["open", "counter_offered", "accepted", "rejected", "expired"] as const
export type NegotiationStatus = (typeof STATUSES)[number]

/** A thread in one of these statuses still takes messages and offers. */
export const ACTIVE_STATUSES: readonly NegotiationStatus[] = ["open", "counter_offered"]
/** Final statuses: nothing changes them, only internal notes are added. */
export const CLOSED_STATUSES: readonly NegotiationStatus[] = ["accepted", "rejected", "expired"]

export function isStatus(value: unknown): value is NegotiationStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
}

/** Who wrote a message or made a change. */
export const AUTHORS = ["customer", "admin", "system"] as const
export type AuthorType = (typeof AUTHORS)[number]

/**
 * What a message is. A plain `message` may carry a price (a customer's new
 * target); `counter`, `accepted`, `rejected` and `expired` mark the moves of
 * the status machine; `note` is an internal note of the team and
 * `draft_order` a record of the draft order writer, both never shown to the
 * customer.
 */
export const MESSAGE_KINDS = ["message", "counter", "accepted", "rejected", "expired", "note", "draft_order"] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** What a thread is about. */
export const SUBJECTS = ["product", "variant", "cart"] as const
export type Subject = (typeof SUBJECTS)[number]

/** Where a thread came from: the Store API, or the demo story of this plugin. */
export const SOURCES = ["store", "demo"] as const
export type ThreadSource = (typeof SOURCES)[number]

/** Whose move it is in an active thread. */
export type WaitingFor = "team" | "customer"

/* ------------------------------------------------------------------ */
/* Defaults and limits of the options                                  */
/* ------------------------------------------------------------------ */

/** Days without activity after which an open thread expires. 0 turns expiry off. */
export const DEFAULT_EXPIRY_DAYS = 14
export const MAX_EXPIRY_DAYS = 365

export const DEFAULT_MAX_MESSAGE_LENGTH = 2000
export const MIN_MESSAGE_LENGTH_LIMIT = 200
export const MAX_MESSAGE_LENGTH_LIMIT = 10_000

export const DEFAULT_MAX_QUANTITY = 100_000
/** Quantities live in an integer column. */
export const MAX_QUANTITY_LIMIT = 1_000_000_000

/** A thread takes at most this many messages from its customer. */
export const MAX_CUSTOMER_MESSAGES_PER_THREAD = 200

export const DEFAULT_MAX_ACTIVE_PER_CUSTOMER = 20
export const DEFAULT_OPEN_PER_HOUR = 10
export const DEFAULT_MESSAGES_PER_HOUR = 60
/** Store reads (lists and threads) per customer per minute. */
export const STORE_READS_PER_MINUTE = 120

/**
 * The largest amount in minor units an integer column holds with room to
 * spare: 20 000 000.00 in a two-decimal currency. Larger input is refused.
 */
export const MAX_AMOUNT = 2_000_000_000

/** Page sizes of the APIs. */
export const ADMIN_PAGE_MAX = 100
export const ADMIN_PAGE_DEFAULT = 20
export const STORE_PAGE_MAX = 50
export const STORE_PAGE_DEFAULT = 20

/** Search across customers and products asks their modules for at most this many ids. */
export const MAX_SEARCH_MATCHES = 100

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

/** The system message of an expired thread (the admin and storefronts show their own text by `kind`). */
export const EXPIRED_TEXT = "The negotiation expired: nobody moved within the expiry window."

/** Expiry: every hour at minute 15. */
export const EXPIRE_SCHEDULE = "15 * * * *"
/** Threads one expiry pass closes at most; the next pass takes the rest. */
export const EXPIRE_BATCH = 500

/** The draft order writer: every 10 minutes, only when it is armed. */
export const DRAFT_ORDERS_SCHEDULE = "*/10 * * * *"
export const DEFAULT_MAX_DRAFT_ORDERS_PER_RUN = 10
/** Failed creates are retried by the job this many times, then wait for a person. */
export const DRAFT_ORDER_MAX_ATTEMPTS = 3
/** A claimed outbox row holds this lease; past it, the row is looked up before anything else. */
export const LEASE_MS = 10 * 60 * 1000

/** Runs kept per kind for the history in Settings. */
export const RUNS_TO_KEEP = 50

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

/** Threads of the demo story keep these ids, so a reseed replaces them in place. */
export const DEMO_ID_PREFIX = "neg_demo_"
/** References of the demo story: NEG-<year>-9001 and on, apart from the real sequence. */
export const DEMO_REF_START = 9001
/** The demo story is rebuilt after this long, so the public demo keeps its threads waiting. */
export const DEMO_RESET_MS = 24 * 60 * 60 * 1000
/** Bumped when the demo generator changes, so the story is rebuilt once. */
export const DEMO_GENERATOR_VERSION = "0.1.0"
