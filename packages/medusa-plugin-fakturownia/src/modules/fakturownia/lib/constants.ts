/**
 * Constants of the Fakturownia module. ZERO IMPORTS on purpose: the unit
 * tests load this file through `node --test` with type stripping, without a
 * build, and every pure module may read it.
 */

/** Container key of the module: `container.resolve(FAKTUROWNIA_MODULE)`. */
export const FAKTUROWNIA_MODULE = "fakturownia"

/** The host of every Fakturownia account: `https://<account>.fakturownia.pl`. */
export const FAKTUROWNIA_DOMAIN = "fakturownia.pl"

/**
 * Document kinds the plugin issues. `receipt` leaves for the API as the
 * `receiptKind` option, `"receipt"` by default (verified: docs/fakturownia-api-notes.md).
 */
export const DOCUMENT_KINDS = ["vat", "proforma", "receipt", "correction"] as const

/** Every state of an outbox row. See `lib/outbox.ts` for the transitions. */
export const DOCUMENT_STATUSES = ["pending", "issuing", "issued", "failed", "unknown", "canceled", "needs_correction"] as const

/* Schedules are static strings: Medusa reads them when it loads the jobs. */

/** The outbox: pending documents and the reconciliation of unknown ones, every 2 minutes. */
export const ISSUE_SCHEDULE = "*/2 * * * *"

/** Unpaid documents of captured orders become paid, every 10 minutes. */
export const PAYMENTS_SCHEDULE = "*/10 * * * *"

/** KSeF status, waiting e-mails, cancellations and the proforma backlog, every 15 minutes. */
export const STATUSES_SCHEDULE = "*/15 * * * *"

/** Documents issued in one pass of the outbox. */
export const DOCUMENTS_PER_PASS = 20

/** Unknown documents reconciled in one pass. */
export const RECONCILE_PER_PASS = 20

/**
 * A claimed row holds at least this lease. A process that dies between the
 * claim and the answer leaves an `issuing` row; after the lease it becomes
 * `unknown`, and an unknown row is reconciled before anything is sent again.
 */
export const ISSUE_LEASE_MS = 10 * 60 * 1000

/**
 * The lease of one attempt, from `timeoutMs`: at least ten minutes, and
 * fifteen request timeouts (lookups of several pages, each read up to three
 * tries, the create and the second look), so about half an hour at the
 * longest timeout. The owner renews it right before the create request
 * leaves; when the renewal finds the claim gone, nothing is sent.
 */
export function claimLeaseMs(timeoutMs: number): number {
  const t = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000
  return Math.max(ISSUE_LEASE_MS, 15 * t)
}

/**
 * After an unknown result Fakturownia may still be committing the document.
 * The reconciliation waits this long before it trusts a "not found".
 */
export const RECONCILE_GRACE_MS = 2 * 60 * 1000

/**
 * The grace of a row whose create request got no answer, counted from the
 * moment the request left: the request may take up to `timeoutMs` to arrive,
 * and Fakturownia a while more to commit it.
 */
export function reconcileGraceMs(timeoutMs: number): number {
  const t = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000
  return RECONCILE_GRACE_MS + t
}

/** Right after an unknown create, one more look a few seconds later. */
export const UNKNOWN_RESULT_RECHECK_MS = 3000

/** `per_page` of the invoice list (100 is the documented maximum). */
export const LOOKUP_PAGE_SIZE = 100

/**
 * Pages one lookup may read. Hitting the ceiling is an error, never a silent
 * "not found": "not found" means "issue it", which is exactly the duplicate
 * the lookup exists to prevent.
 */
export const LOOKUP_MAX_PAGES = 10

/** The lookup window starts this many days before the row was created. */
export const LOOKUP_DAYS_BEFORE = 7

/**
 * Retry delays in seconds, by attempt; the last value repeats. 14 attempts
 * cover about two and a half days, so an outage over a weekend catches up by
 * itself and only then does a row wait for a person.
 */
export const BACKOFF_SECONDS: readonly number[] = [60, 120, 300, 600, 1800, 3600, 7200, 14_400, 21_600, 43_200]
export const MAX_ATTEMPTS = 14

/** Sync runs kept per kind for the admin history. */
export const RUNS_TO_KEEP = 50

/** Fakturownia documents no rate limit; the plugin stays polite by default. */
export const DEFAULT_REQUESTS_PER_MINUTE = 60
export const MAX_REQUESTS_PER_MINUTE = 600

/** Creating a document on a KSeF account validates it first, so the timeout is generous. */
export const DEFAULT_TIMEOUT_MS = 30_000

export const DEFAULT_VAT_RATE = 23
export const DEFAULT_LANG = "pl"
export const DEFAULT_RECEIPT_KIND = "receipt"
export const DEFAULT_SHIPPING_POSITION_NAME = "Dostawa"
export const DEFAULT_QUANTITY_UNIT = "szt."
export const DEFAULT_PAYMENT_TERM_DAYS = 7

/** Where the buyer's tax ID (NIP) is looked for: order metadata, then billing address metadata. */
export const DEFAULT_TAX_ID_METADATA_KEYS: readonly string[] = ["nip", "tax_id", "invoice_nip"]

/** Order metadata keys that may carry the company name when the billing address has none. */
export const COMPANY_METADATA_KEYS: readonly string[] = ["invoice_company", "company_name", "company"]

/** Payment providers meaning cash on delivery. Prefix match on the provider id. */
export const DEFAULT_COD_PROVIDERS: readonly string[] = ["pp_cod", "pp_cash"]

/** Fakturownia `payment_type` keys (documented values). */
export const COD_PAYMENT_TYPE = "cash_on_delivery"
export const DEFAULT_PAYMENT_TYPE = "transfer"

/** Issued documents whose KSeF status is read, for this many days after issue. */
export const STATUS_WINDOW_DAYS = 14

/** Documents whose KSeF status is read in one pass. */
export const STATUSES_PER_PASS = 40

/** Documents marked paid in one pass. */
export const PAYMENTS_PER_PASS = 30

/** A waiting e-mail (KSeF number not assigned yet) is tried for this many days. */
export const EMAIL_RETRY_DAYS = 3

/**
 * An automatic e-mail taken for sending (`sending`) longer than this belongs
 * to a process that stopped mid-request: it becomes `failed` with a note that
 * it may have gone out, and is never sent again by the plugin.
 */
export const EMAIL_CLAIM_STALE_MS = 15 * 60 * 1000

/** Proformas checked for a fulfillment the event missed, per pass, and how far back. */
export const FINALS_PER_PASS = 30
export const FINALS_WINDOW_DAYS = 60

/** Amounts closer than this are the same amount (two cents of rounding between systems). */
export const AMOUNT_TOLERANCE = 0.02

/** Demo mode, first visit: the newest orders get simulated documents. */
export const DEMO_BACKFILL_ORDERS = 10

/* ---- 0.2.0 ---------------------------------------------------------- */

/** Correction plans: the scan for changes the events missed, every 30 minutes. */
export const CORRECTIONS_SCHEDULE = "*/30 * * * *"

/** Approved corrections issued in one pass of the outbox (the per run cap of the corrections writer). */
export const CORRECTIONS_PER_PASS = 10

/** Issued documents checked for changes in one scan, the least recently checked first. */
export const CORRECTIONS_SCAN_PER_PASS = 20

/** Documents issued within this many days are scanned for changes. */
export const CORRECTIONS_WINDOW_DAYS = 90

/** Unpaid proformas and VAT invoices older than this many days are listed for a reminder. */
export const DEFAULT_REMINDER_AFTER_DAYS = 7

/** One payment reminder per document in this many hours at most. */
export const REMINDER_MIN_INTERVAL_HOURS = 24

/** One "send to KSeF again" per document in this many minutes at most. */
export const KSEF_RESEND_MIN_INTERVAL_MS = 5 * 60 * 1000

/** `email_to` takes up to five addresses (documented). */
export const MAX_EMAIL_RECIPIENTS = 5

/** Storefront routes of a logged-in customer: requests per minute per customer. */
export const STORE_LIST_PER_MINUTE = 30
export const STORE_PDF_PER_MINUTE = 10

/** The monthly summary covers this many months and reads at most this many rows. */
export const SUMMARY_MONTHS = 12
export const SUMMARY_MAX_ROWS = 25_000

/**
 * Events the plugin emits on the Medusa event bus. `issued` and `corrected`
 * are the contract other plugins build on (`lib/events.ts`); the three with an
 * underscore are the events of 0.1.0, kept as they were.
 */
export const PLUGIN_EVENTS = {
  issued: "fakturownia.document.issued",
  corrected: "fakturownia.document.corrected",
  documentIssued: "fakturownia.document_issued",
  documentFailed: "fakturownia.document_failed",
  documentNeedsAttention: "fakturownia.document_needs_attention",
} as const
