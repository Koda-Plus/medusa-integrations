/**
 * Constants of the Ceneo module. ZERO IMPORTS on purpose: this file is
 * shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const CENEO_MODULE = "ceneo"

/* TABLE NAMES, namespaced. */
export const FEED_TABLE = "ceneo_feed"
export const OFFER_TABLE = "ceneo_offer"
export const CATEGORY_TABLE = "ceneo_category"
export const CATEGORY_MAP_TABLE = "ceneo_category_map"
export const CONSENT_TABLE = "ceneo_consent"
export const ORDER_TABLE = "ceneo_order"
export const WRITER_TABLE = "ceneo_writer"
export const BID_TABLE = "ceneo_bid"

export const ID_PREFIX = {
  feed: "cfd",
  offer: "cof",
  category: "cct",
  categoryMap: "ccm",
  consent: "ccs",
  order: "cor",
} as const

/** The public Ceneo category tree, read once a day. */
export const CENEO_TREE_URL = "https://developers.ceneo.pl/api/v3/kategorie"
/** The tree job: once a day at 03:20, and the admin button. */
export const CATEGORY_JOB_SCHEDULE = "20 3 * * *"

/** Kup Teraz: the order sync every 5 minutes, over the orders of the last 14 days, at most 50 pages a run. */
export const ORDERS_JOB_SCHEDULE = "*/5 * * * *"
export const ORDERS_WINDOW_DAYS = 14
export const ORDERS_MAX_PAGES = 50
/** Item reads per run (new orders and orders whose state moved); the rest waits for the next run. */
export const ORDERS_ITEMS_PER_RUN = 50

/** CPC: bids and the top 10 read, then the armed writers, every hour at minute 25. */
export const CPC_JOB_SCHEDULE = "25 * * * *"

/** Zaufane Opinie answers are kept this long (Ceneo sends the survey within 21 working days). */
export const CONSENT_KEEP_DAYS = 90
/** The pruning job: once a day at 03:40. */
export const CONSENT_JOB_SCHEDULE = "40 3 * * *"
/** The plugin's metadata namespace a shopper may not write (kit reservedMetadataGuard). */
export const RESERVED_METADATA_PREFIXES = ["ceneo_"] as const

/** Where the brand (`Marka`) of a product comes from. */
export const BRAND_SOURCES = ["metadata", "type", "collection", "tag"] as const
export type BrandSource = (typeof BRAND_SOURCES)[number]

/* ------------------------------------------------------------------ */
/* The Ceneo XML feed                                                  */
/* https://www.ceneo.pl/poradniki/Instrukcja-tworzenia-pliku-XML       */
/* ------------------------------------------------------------------ */

/**
 * The `avail` values Ceneo accepts:
 *
 *   1    available, ships within 24 hours
 *   3    ships within 3 days
 *   7    ships within a week
 *   14   ships within 14 days
 *   90   made to order
 *   99   "check in the store"
 *   110  pre-sale
 */
export const AVAIL_VALUES = [1, 3, 7, 14, 90, 99, 110] as const
export type Avail = (typeof AVAIL_VALUES)[number]

export function isAvail(value: unknown): value is Avail {
  return typeof value === "number" && (AVAIL_VALUES as readonly number[]).includes(value)
}

/** Limits of the feed, from the Ceneo instructions. */
export const LIMITS = {
  offerId: 100,
  url: 1000,
  name: 150,
  category: 255,
  description: 100_000,
  images: 20,
  attributes: 500,
} as const

/** Where the offer id comes from: the variant id never changes, the SKU can. */
export const OFFER_ID_SOURCES = ["variant_id", "sku"] as const
export type OfferIdSource = (typeof OFFER_ID_SOURCES)[number]

/** What happens to a variant without stock (and without backorders). */
export const OUT_OF_STOCK_MODES = ["skip", "check"] as const
export type OutOfStockMode = (typeof OUT_OF_STOCK_MODES)[number]

/**
 * The state of one offer after a feed build:
 *
 *   ok        in the feed, nothing to fix
 *   warning   in the feed, something to improve (no EAN, a name cut to 150)
 *   error     left out of the feed until fixed (no price, no category, no URL)
 *   excluded  left out on purpose (out of stock with outOfStock "skip")
 */
export const OFFER_STATES = ["ok", "warning", "error", "excluded"] as const
export type OfferState = (typeof OFFER_STATES)[number]

export function isOfferState(value: unknown): value is OfferState {
  return typeof value === "string" && (OFFER_STATES as readonly string[]).includes(value)
}

/** A feed token: 16 to 128 characters of letters, digits, `-` and `_`. */
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
/** A Zaufane Opinie account GUID from Panel Ceneo. */
export const ACCOUNT_GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
/** The placeholders of the product URL template. */
export const URL_PLACEHOLDERS = ["{handle}", "{product_id}", "{variant_id}", "{sku}"] as const

/* ------------------------------------------------------------------ */
/* Problems of an offer                                                */
/* ------------------------------------------------------------------ */

/**
 * Every problem a build can find, with what it does to the offer:
 *
 *   error     the offer stays out of the feed until fixed
 *   excluded  the offer stays out on purpose (unpublished, sold out, gone)
 *   warning   the offer goes to the feed, something is worth improving
 *
 * The feed never carries an offer with an error. The state of an offer is
 * its worst problem: error, then excluded, then warning, else ok.
 */
export const PROBLEMS = {
  price_missing: "error",
  price_net: "error",
  url_missing: "error",
  url_too_long: "error",
  sku_missing: "error",
  offer_id_too_long: "error",
  offer_id_duplicate: "error",
  offer_id_taken: "error",
  name_missing: "error",
  category_required: "error",
  unpublished: "excluded",
  out_of_stock: "excluded",
  variant_gone: "excluded",
  offer_id_replaced: "excluded",
  name_cut: "warning",
  category_missing: "warning",
  category_unmapped: "warning",
  category_removed: "warning",
  brand_missing: "warning",
  url_slash: "warning",
  category_cut: "warning",
  description_cut: "warning",
  image_missing: "warning",
  images_cut: "warning",
  image_url_invalid: "warning",
  ean_missing: "warning",
  ean_invalid: "warning",
  stock_unknown: "warning",
} as const

export type ProblemCode = keyof typeof PROBLEMS
export type ProblemSeverity = (typeof PROBLEMS)[ProblemCode]

/** How many feed builds keep their XML (the served one and a few before it). */
export const FEED_XML_KEEP = 5
/** How many feed builds are kept at all (the build history of the admin). */
export const FEED_ROWS_KEEP = 50
/** The feed job wakes every 5 minutes and builds when the interval has passed or the catalog changed. */
export const FEED_JOB_SCHEDULE = "*/5 * * * *"
