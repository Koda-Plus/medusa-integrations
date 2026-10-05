/**
 * Constants of the Subiekt nexo plugin. ZERO IMPORTS: the unit tests load
 * this file as is, and every pure module may read it.
 */

/** Container key of the module: `container.resolve(SUBIEKT_MODULE)`. */
export const SUBIEKT_MODULE = "subiekt_nexo"

/** Version of `contract/openapi.yaml` this plugin speaks. */
export const CONTRACT_VERSION = "1.1.0"

/** Version of this plugin, sent in the User-Agent and shown in the admin. */
export const PLUGIN_VERSION = "0.2.0"

/**
 * The row of `subiekt_connection`: one per mode, so switching between the demo
 * bridge and a real one never mixes their event cursors or health.
 */
export const CONNECTION_ID = "default"
export const DEMO_CONNECTION_ID = "demo"

/** Header carrying `t=<unix>,v1=<hex>` in both directions. */
export const SIGNATURE_HEADER = "x-koda-signature"

/** A signature older or newer than this is rejected. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

/** One bridge request. Creating a ZK takes 1 to 5 s in Sfera, a cold start up to 30 s. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Due tasks: every minute. A subscriber also starts the queue right after an event. */
export const TASKS_SCHEDULE = "* * * * *"

/** Event feed (WZ issued in Subiekt): every 2 minutes, and right after a webhook. */
export const EVENTS_SCHEDULE = "*/2 * * * *"

/** Stock from Subiekt: every 10 minutes. One page of 500 products is one request. */
export const STOCK_SCHEDULE = "*/10 * * * *"

/** Products and prices from Subiekt: once an hour. Prices change rarely and the bridge reads whole price lists. */
export const PRODUCTS_SCHEDULE = "17 * * * *"

/** Tasks taken from the queue in one pass. */
export const TASKS_PER_PASS = 25

/**
 * Retry delays in seconds, by attempt. The last value repeats. 14 attempts
 * cover about 2.5 days, so a bridge machine that was off over a weekend
 * catches up by itself, and a task fails for good only after that.
 */
export const BACKOFF_SECONDS: readonly number[] = [60, 120, 300, 600, 1800, 3600, 7200, 14_400, 21_600, 43_200]
export const MAX_ATTEMPTS = 14

/** A task stuck in `running` this long (a crashed process) goes back to the queue. */
export const RUNNING_STALE_MS = 10 * 60 * 1000

/** Pages read from the bridge. */
export const STOCK_PAGE_SIZE = 500
export const STOCK_MAX_PAGES = 200
export const EVENTS_PAGE_SIZE = 100
export const EVENTS_MAX_PAGES = 20
export const PRODUCTS_PAGE_SIZE = 500
export const PRODUCTS_MAX_PAGES = 200

/** Writers apply at most this many changes in one run; the rest waits for the next run. */
export const DEFAULT_MAX_PRICE_CHANGES_PER_RUN = 200
export const DEFAULT_MAX_PRODUCTS_PER_RUN = 20

/** An item that failed this many runs in a row is quarantined until a person releases it. */
export const QUARANTINE_AFTER_FAILURES = 3

/**
 * Clock skew. Signatures allow 300 seconds both ways; the admin warns from
 * 60 seconds, so a drifting clock is fixed before every request starts failing.
 */
export const CLOCK_SKEW_WARN_SECONDS = 60
export const CLOCK_SKEW_LIMIT_SECONDS = 300

/** What a bridge without `capabilities` (contract 1.0) does. */
export const LEGACY_CAPABILITIES: readonly string[] = ["orders", "fulfillments", "stock", "events"]

/** Sync runs kept per kind. */
export const RUNS_TO_KEEP = 60

/**
 * Payment providers paid before shipping. For them the ZK waits for the
 * capture, so the warehouse never packs an order that may still fail to pay.
 * Prefix match: `pp_stripe` covers `pp_stripe_stripe` and `pp_stripe-blik_stripe`.
 */
export const DEFAULT_PREPAID_PROVIDERS: readonly string[] = [
  "pp_stripe",
  "pp_p24",
  "pp_przelewy24",
  "pp_payu",
  "pp_tpay",
  "pp_paypal",
  "pp_adyen",
  "pp_mollie",
]

/** Providers meaning cash on delivery. Prefix match. */
export const DEFAULT_COD_PROVIDERS: readonly string[] = ["pp_cod", "pp_cash"]

/** Order metadata the plugin writes. Other plugins and the storefront may read it. */
export const ORDER_METADATA = {
  zkNumber: "subiekt_zk_number",
  zkIssuedAt: "subiekt_zk_issued_at",
  wzNumber: "subiekt_wz_number",
  wzIssuedAt: "subiekt_wz_issued_at",
  /** Since 0.2.0: the FS or PA of the order. */
  salesDocumentNumber: "subiekt_sales_document_number",
  salesDocumentKind: "subiekt_sales_document_kind",
  ksefNumber: "subiekt_ksef_number",
} as const

/** Events the plugin emits on the Medusa event bus. */
export const PLUGIN_EVENTS = {
  documentIssued: "subiekt.document_issued",
  /** Since 0.2.0: a document changed, for example KSeF assigned the number of an FS. */
  documentUpdated: "subiekt.document_updated",
  taskFailed: "subiekt.task_failed",
} as const

/** Order metadata keys searched for a tax id (NIP) when the buyer wants an invoice. */
export const TAX_ID_METADATA_KEYS: readonly string[] = ["tax_id", "nip", "vat_id", "invoice_nip", "company_tax_id"]

/**
 * Where the plugin looks for the buyer's NIP (`nipSources`), in this order:
 * order metadata, billing address metadata, then the billing company field,
 * where many checkouts let the buyer type "Firma ABC, NIP 123-456-32-18".
 */
export const DEFAULT_NIP_SOURCES: readonly string[] = [
  ...TAX_ID_METADATA_KEYS.map((k) => `metadata.${k}`),
  ...TAX_ID_METADATA_KEYS.map((k) => `billing_address.metadata.${k}`),
  "billing_address.company",
]

/** Demo: a ZK gets its WZ this long after it was created. */
export const DEMO_WZ_AFTER_MS = 3 * 60 * 1000
