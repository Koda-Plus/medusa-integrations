/**
 * Constants of the Ceneo module. ZERO IMPORTS on purpose: this file is
 * shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const CENEO_MODULE = "ceneo"

/* TABLE NAMES, namespaced. */
export const FEED_TABLE = "ceneo_feed"
export const OFFER_TABLE = "ceneo_offer"

export const ID_PREFIX = {
  feed: "cfd",
  offer: "cof",
} as const

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
