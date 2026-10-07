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
 * Leases in `baselinker_setting` (`lease:job:<kind>`, `lease:lock:<key>`):
 * one run of each job and one worker per record across every process of the
 * store (server, worker, several instances). A lease is renewed while its
 * holder works and expires this long after a process died.
 */
export const LEASE_TTL_MS = 5 * 60 * 1000

/** How often a holder renews its lease. */
export const LEASE_RENEW_MS = 60 * 1000

/** Demo mode only: the simulated warehouse moves orders on and the first snapshot is built, every minute. */
export const DEMO_SCHEDULE = "* * * * *"

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
  /** `true` on orders this plugin created from BaseLinker: they never go back to BaseLinker. */
  imported: "baselinker_imported",
  source: "baselinker_order_source",
  externalOrderId: "baselinker_external_order_id",
  /**
   * Shared with the other Koda Plus marketplace plugins: `"<source>:<external id>"`,
   * for Allegro `"allegro:<checkout form id>"`. One marketplace order, one Medusa order,
   * whichever plugin imports it first.
   */
  marketplaceRef: "marketplace_order_ref",
  /**
   * The id of the import row the order was created from (a plugin id a
   * shopper cannot guess): the recovery after a crash adopts an order by its
   * BaseLinker number only when this matches, or when the order has no cart.
   */
  importId: "baselinker_import_id",
  /** `true` on orders the demo created (`demoCreatesOrders`): sample data, safe to delete. */
  demo: "baselinker_demo",
} as const

/** Product metadata of products created by the catalog import. */
export const PRODUCT_METADATA = {
  /** The BaseLinker main product the Medusa product was created from. */
  productId: "baselinker_product_id",
  manufacturer: "manufacturer",
} as const

/** Events the plugin emits on the Medusa event bus. */
export const PLUGIN_EVENTS = {
  orderSent: "baselinker.order_sent",
  orderFailed: "baselinker.order_failed",
  orderStatusChanged: "baselinker.order_status_changed",
  orderImported: "baselinker.order_imported",
  orderImportFailed: "baselinker.order_import_failed",
  planApplied: "baselinker.plan_applied",
  invoiceNumberWritten: "baselinker.invoice_number_written",
} as const

/**
 * Order metadata keys a shopper may not set through the Store API (the
 * kit's reservedMetadataGuard): every `baselinker_*` key and the shared
 * marketplace reference. The plugin never decides anything by them anyway;
 * its own tables are the record.
 */
export const RESERVED_METADATA_PREFIXES: readonly string[] = ["baselinker_"]
export const RESERVED_METADATA_KEYS: readonly string[] = ["marketplace_order_ref"]

/**
 * Emitted by the Fakturownia plugin of Koda Plus when it issues a document:
 * `{ id, order_id, kind, number, external_id, demo }`. A soft dependency: the
 * plugin listens by name and never imports the Fakturownia package.
 */
export const FAKTUROWNIA_DOCUMENT_ISSUED = "fakturownia.document.issued"

/* ------------------------------------------------------------------ */
/* Version 0.2: both directions                                        */
/* ------------------------------------------------------------------ */

/** `getInventoryProductsData` ids per call. No limit is documented; 100 keeps one answer small. */
export const DETAILS_BATCH = 100

/** `updateInventoryProductsStock` and `updateInventoryProductsPrices`: at most 1000 products per call (documented). */
export const BULK_UPDATE_MAX = 1000

/** Catalog changes (imported products, created or updated cards) applied by one run. */
export const DEFAULT_MAX_CATALOG_CHANGES = 200

/** Price changes written to BaseLinker by one run. */
export const DEFAULT_MAX_PRICE_CHANGES = 1000

/** Failed runs of one item before it is quarantined and left for a person. */
export const DEFAULT_QUARANTINE_AFTER = 3

/** Products created or updated in one Medusa workflow call. */
export const IMPORT_APPLY_BATCH = 10

/** Option title of products the catalog import creates with several variants. */
export const DEFAULT_IMPORT_OPTION_TITLE = "Variant"

/** Marketplace orders from BaseLinker into Medusa: every 5 minutes. */
export const IMPORT_SCHEDULE = "*/5 * * * *"

/** Returns from BaseLinker (read only): every hour at minute 45. */
export const RETURNS_SCHEDULE = "45 * * * *"

/** BaseLinker orders turned into Medusa orders in one pass. */
export const IMPORTS_PER_PASS = 20

/** `getOrders` pages one discovery pass reads (100 orders each). */
export const IMPORT_PAGES_PER_PASS = 5

/** Without `orderImportSince`, the first discovery looks back this far, so a fresh setup does not pull a year of orders. */
export const IMPORT_FIRST_LOOKBACK_HOURS = 24

/** A discovered order older than this when the writer gets to it is skipped, not imported (a person can retry it). */
export const DEFAULT_IMPORT_MAX_AGE_HOURS = 72

/** Before the Medusa order is created, the next attempt of a row moves this far ahead (a dead process leaves no stuck row). */
export const IMPORT_LEASE_MS = 10 * 60 * 1000

/** Returns of the last N days are read. */
export const DEFAULT_RETURNS_WINDOW_DAYS = 30

/** `getOrderReturns` pages per run (100 returns each). */
export const RETURNS_MAX_PAGES = 20

/** Journal events the status read listens to: order created, payment, removal, parcels, status change. */
export const JOURNAL_LOG_TYPES: readonly number[] = [1, 3, 4, 9, 10, 18, 22]

/** When the journal works, the full status read still runs this often, as a safety net. */
export const JOURNAL_FULL_PASS_MS = 2 * 60 * 60 * 1000

/** The journal keeps three days; a cursor older than this means events may be gone, so the next read goes the full way. */
export const JOURNAL_STALE_MS = 2 * 24 * 60 * 60 * 1000

/** Invoice numbers written to BaseLinker in one pass. */
export const INVOICES_PER_PASS = 20

/** Fakturownia document kinds whose number goes to BaseLinker by default. */
export const DEFAULT_INVOICE_KINDS: readonly string[] = ["vat", "receipt"]

/** BaseLinker order field that receives the invoice number by default (varchar 50, "any information"). */
export const DEFAULT_INVOICE_FIELD = "extra_field_1"

/** Order metadata keys searched for the buyer's tax id (NIP) when they want an invoice. */
export const TAX_ID_METADATA_KEYS: readonly string[] = ["invoice_nip", "tax_id", "nip", "vat_id", "company_tax_id"]

/** Order metadata keys searched for the buyer's note to the warehouse. */
export const NOTE_METADATA_KEYS: readonly string[] = ["customer_note", "note", "notes", "comment", "order_note"]
