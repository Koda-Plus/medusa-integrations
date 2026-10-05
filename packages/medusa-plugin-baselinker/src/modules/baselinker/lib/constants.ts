/**
 * Constants of the BaseLinker module. ZERO IMPORTS on purpose: the unit tests
 * load this file through `node --test` with type stripping, without a build,
 * and every pure module may read it.
 */

/** Container key of the module: `container.resolve(BASELINKER_MODULE)`. */
export const BASELINKER_MODULE = "baselinker"

/** Page size of `getInventoryProductsList`. A shorter page is the last one. */
export const CATALOG_PAGE_SIZE = 1000

/**
 * Hard ceiling for one catalog read: 200 pages = 200 000 cards. A loop over
 * somebody else's API must have a limit. Hitting it marks the read incomplete.
 */
export const CATALOG_MAX_PAGES = 200

/** `getOrders` returns up to 100 orders per call; a shorter page is the end. */
export const ORDERS_PAGE_SIZE = 100

/**
 * How many `getOrders` pages the marker scan may read. Hitting the ceiling is
 * an error, never a silent "not found": "not found" means "create it", which
 * is exactly the duplicate the scan exists to prevent.
 */
export const MARKER_SCAN_MAX_PAGES = 20

/** The marker scan starts this long before the order was placed: clocks on both sides drift. */
export const MARKER_SCAN_LOOKBACK_SECONDS = 3600

/** After an unknown `addOrder` result, BaseLinker may still be committing: wait, then scan again. */
export const UNKNOWN_RESULT_RESCAN_MS = 3000

/** Pages of the batched status read (orders of our own source, 100 per page). */
export const STATUS_BATCH_MAX_PAGES = 10

/* Schedules are static strings: Medusa reads them when it loads the jobs. */

/** Cards and the stock plan: every hour at minute 15. */
export const CATALOG_SCHEDULE = "15 * * * *"

/** The order outbox: every 2 minutes. The subscriber also sends right after `order.placed`. */
export const ORDERS_SCHEDULE = "*/2 * * * *"

/** Status and tracking back from BaseLinker: every 15 minutes. */
export const STATUSES_SCHEDULE = "*/15 * * * *"

/** Orders sent in one pass of the outbox. */
export const ORDERS_PER_PASS = 20

/** Sent orders whose status is read in one pass. */
export const STATUSES_PER_PASS = 60

/** Fulfillments created in one pass. */
export const FULFILLMENTS_PER_PASS = 20

/** Sent orders are followed this many days after sending, unless a closing status ends it earlier. */
export const STATUS_WINDOW_DAYS = 30

/**
 * Before the network call, the next attempt of a row moves this far ahead. A
 * process that dies in the middle of a send leaves a row that comes back by
 * itself ten minutes later, and every attempt scans for the marker first.
 */
export const SEND_LEASE_MS = 10 * 60 * 1000

/** A per-order lock (Medusa Locking module) expires after this many seconds. */
export const ORDER_LOCK_SECONDS = 300

/**
 * Retry delays in seconds, by attempt; the last value repeats. 14 attempts
 * cover about two and a half days, so a BaseLinker outage over a weekend
 * catches up by itself and only then does a row wait for a person.
 */
export const BACKOFF_SECONDS: readonly number[] = [60, 120, 300, 600, 1800, 3600, 7200, 14_400, 21_600, 43_200]
export const MAX_ATTEMPTS = 14

/** Sync runs kept per kind for the admin history. */
export const RUNS_TO_KEEP = 50

/** BaseLinker allows 100 requests per minute per token; the plugin stays below by default. */
export const DEFAULT_REQUESTS_PER_MINUTE = 80
export const MAX_REQUESTS_PER_MINUTE = 100
export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_STOCK_CHANGES = 500

/** Payment providers meaning cash on delivery. Prefix match on the provider id. */
export const DEFAULT_COD_PROVIDERS: readonly string[] = ["pp_cod", "pp_cash"]

/** `order.metadata[key] === true` keeps an order away from BaseLinker (test orders). */
export const DEFAULT_SKIP_METADATA_KEY = "baselinker_skip"

/** Order metadata the plugin writes. The storefront and other plugins may read it. */
export const ORDER_METADATA = {
  orderId: "baselinker_order_id",
  statusId: "baselinker_status_id",
  statusName: "baselinker_status_name",
  trackingNumber: "baselinker_tracking_number",
  trackingUrl: "baselinker_tracking_url",
  carrier: "baselinker_carrier",
} as const

/** Events the plugin emits on the Medusa event bus. */
export const PLUGIN_EVENTS = {
  orderSent: "baselinker.order_sent",
  orderFailed: "baselinker.order_failed",
  orderStatusChanged: "baselinker.order_status_changed",
} as const

/** Order metadata keys searched for the buyer's tax id (NIP) when they want an invoice. */
export const TAX_ID_METADATA_KEYS: readonly string[] = ["invoice_nip", "tax_id", "nip", "vat_id", "company_tax_id"]

/** Order metadata keys searched for the buyer's note to the warehouse. */
export const NOTE_METADATA_KEYS: readonly string[] = ["customer_note", "note", "notes", "comment", "order_note"]
