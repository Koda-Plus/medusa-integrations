/**
 * Options of `@koda-plus/medusa-plugin-ceneo`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-ceneo", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting: a
 * broken value falls back to its default, a missing one leaves its part of
 * the plugin waiting, and the admin says what is missing. Demo mode is only
 * ever on with `demo: true`, never because a key is missing.
 */

import {
  ACCOUNT_GUID_PATTERN,
  BRAND_SOURCES,
  FEED_TOKEN_PATTERN,
  OFFER_ID_SOURCES,
  URL_PLACEHOLDERS,
  isAvail,
  type Avail,
  type BrandSource,
  type OfferIdSource,
  type OutOfStockMode,
} from "./constants"
import { WRITER_KEYS, type WriterKey } from "./writers"

export interface CeneoFeedOptions {
  /**
   * The secret part of the feed address: `/ceneo/feed/<token>.xml`. 16 to
   * 128 letters, digits, `-` or `_` (`openssl rand -hex 24`). Ceneo reads
   * the file without a password, so the token keeps it from being guessed.
   * Without a token the feed is not served.
   */
  token?: string
  /**
   * The storefront address of a product, with placeholders: `{handle}`,
   * `{product_id}`, `{variant_id}`, `{sku}`. Example:
   * `https://shop.example.com/pl/products/{handle}?variant={variant_id}`.
   * Required: Ceneo sends shoppers there.
   */
  productUrl?: string
  /** The Medusa region the prices come from (reg_...). Default: the first region in PLN. */
  regionId?: string
  /** The sales channel whose products go to Ceneo (sc_...). Default: the default sales channel of the store. */
  salesChannelId?: string
  /** The offer id: "variant_id" (default, never changes) or "sku" (to keep the ids of an older feed). */
  offerId?: OfferIdSource | string
  /** `avail` of a variant in stock. Default 1 (ships within 24 hours). */
  inStockAvail?: Avail | number | string
  /** `avail` of a variant sold on backorder. Default 7. */
  backorderAvail?: Avail | number | string
  /** A variant out of stock: "skip" (default, left out) or "check" (`avail` 99, "check in the store"). */
  outOfStock?: OutOfStockMode | string
  /** Minutes between feed builds. Default 30, from 5 to 1440. */
  intervalMinutes?: number | string
  /**
   * Variants whose Medusa category has no Ceneo mapping: true (default) sends
   * them with the Medusa category path (Ceneo maps it on its side, a
   * warning here), false keeps them out until mapped.
   */
  includeUnmapped?: boolean | string
  /**
   * Where `Marka` comes from: `{ from: "metadata", key: "brand" }` (default:
   * the product metadata key), `{ from: "type" }` (product type),
   * `{ from: "collection" }` (collection title) or
   * `{ from: "tag", key: "marka:" }` (the tag that starts with the key, the
   * rest is the brand). `false` sends no brand and no warning.
   */
  brand?: { from?: BrandSource | string; key?: string } | false
}

export interface CeneoReviewsOptions {
  /** The Zaufane Opinie account GUID, from Panel Ceneo (Opinie, Zaufane Opinie, Instrukcja instalacji). */
  accountGuid?: string
  /** Working days before Ceneo sends the survey, 0 to 21. Default: Ceneo decides (the category average). */
  workDays?: number | string
}

export interface CeneoWritesOptions {
  /** Kup Teraz orders become Medusa orders. Default: true in demo mode, false otherwise. */
  orders?: boolean | string
  /** Ceneo learns the shop order number, the confirmation, the parcel number and cancellations. Default: true in demo mode, false otherwise. */
  status?: boolean | string
  /** CPC bids, one planned step per run. Default: true in demo mode, false otherwise. */
  bids?: boolean | string
  /** Promotion texts per product and category. Default: true in demo mode, false otherwise. */
  promo?: boolean | string
}

export interface CeneoOrdersOptions {
  /**
   * The Ceneo state ids (OrderStates) of orders ready to ship: only these are
   * imported. Ceneo documents only states 1 and 2 (waiting for payment,
   * unpaid); the account's full list is in the admin. Without it the import
   * stays off. Demo: the simulated states 101 and 102.
   */
  importStates?: number[] | string
  /** State ids that mean "cancelled at Ceneo": an imported order not yet shipped is cancelled in Medusa. */
  canceledStates?: number[] | string
  /** PaymentTypeId values paid up front: their Medusa orders get a captured payment. Others stay not paid (cash on delivery). */
  paidPaymentTypes?: number[] | string
  /** The Medusa shipping option for imported orders (so_...). Optional. */
  shippingOptionId?: string
  /** The ParcelCarriers id sent with a parcel number. Without it parcel numbers are not sent. */
  carrierId?: number | string
  /** The reason Ceneo gets when the store cancels an order. */
  cancelReason?: string
}

export interface CeneoCpcOptions {
  /** The highest bid ever sent, in PLN ("0.80"). Without it the bids writer stays off (demo: 2.00). */
  maxBid?: number | string
  /** How far one run may move a bid, in percent of the current one. Default 50. */
  maxBidChangePercent?: number | string
  /** Offers read per hourly run (bids and the top 10), 10 to 3000. Default 300. */
  perRun?: number | string
  /** The store's name as Ceneo lists it among the offers ("mojsklep.pl"): the position in the top 10. */
  shopName?: string
}

export interface CeneoPluginOptions {
  /** Demo mode: a simulated Ceneo API, rows flagged demo. Default: false. */
  demo?: boolean | string
  feed?: CeneoFeedOptions
  reviews?: CeneoReviewsOptions
  /**
   * The Ceneo API key from Panel Ceneo (Kup Teraz orders, CPC bids,
   * promotion texts). Ceneo gives one only to stores already integrated.
   * Never in the repository: `process.env.CENEO_API_KEY`.
   */
  apiKey?: string
  /** How long one Ceneo call may take, in milliseconds. Default 15000. */
  timeoutMs?: number | string
  /** The hard switches of the writers. A person still arms each one in the admin. */
  writes?: CeneoWritesOptions
  orders?: CeneoOrdersOptions
  cpc?: CeneoCpcOptions
}

export interface ResolvedFeedOptions {
  token: string | null
  /** A token was given but does not match the pattern: the feed stays off. */
  tokenRejected: boolean
  productUrl: string | null
  /** A product URL was given but is not an http(s) template with a placeholder. */
  productUrlRejected: boolean
  regionId: string | null
  salesChannelId: string | null
  offerId: OfferIdSource
  inStockAvail: Avail
  backorderAvail: Avail
  outOfStock: OutOfStockMode
  intervalMinutes: number
  includeUnmapped: boolean
  /** null: no brand at all. */
  brand: { from: BrandSource; key: string | null } | null
}

export interface ResolvedCeneoOptions {
  demo: boolean
  feed: ResolvedFeedOptions
  reviews: { accountGuid: string | null; accountGuidRejected: boolean; workDays: number | null }
  apiKey: string | null
  timeoutMs: number
  writes: Record<WriterKey, boolean>
  orders: {
    importStates: number[]
    canceledStates: number[]
    paidPaymentTypes: number[]
    shippingOptionId: string | null
    carrierId: number | null
    cancelReason: string
  }
  cpc: {
    /** Grosze; null: no ceiling, the bids writer stays off. */
    maxBid: number | null
    maxBidChangePercent: number
    perRun: number
    shopName: string | null
  }
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function num(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) return Number(value.trim())
  return Number.NaN
}

/** A list of non negative integers: an array or "1, 2, 3". */
function ints(value: unknown): number[] | null {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/).filter(Boolean) : null
  if (!raw) return null
  const out = raw.map((v) => num(v)).filter((n) => Number.isInteger(n) && n >= 0)
  return [...new Set(out)].sort((a, b) => a - b)
}

function avail(value: unknown, fallback: Avail): Avail {
  const n = num(value)
  return isAvail(n) ? n : fallback
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = num(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
}

/** A product URL template: http(s) and at least one placeholder that tells products apart. */
export function isProductUrlTemplate(value: string): boolean {
  return URL_PATTERN.test(value) && URL_PLACEHOLDERS.some((p) => value.includes(p))
}

function resolveBrand(value: CeneoFeedOptions["brand"]): ResolvedFeedOptions["brand"] {
  if (value === false) return null
  const v = value && typeof value === "object" ? value : {}
  const from: BrandSource = typeof v.from === "string" && (BRAND_SOURCES as readonly string[]).includes(v.from) ? (v.from as BrandSource) : "metadata"
  const key = str(v.key)
  if (from === "metadata") return { from, key: key ?? "brand" }
  if (from === "tag") return key ? { from, key } : null
  return { from, key: null }
}

function isOfferIdSource(value: unknown): value is OfferIdSource {
  return typeof value === "string" && (OFFER_ID_SOURCES as readonly string[]).includes(value)
}

export function resolveOptions(o: CeneoPluginOptions | undefined | null): ResolvedCeneoOptions {
  const opts = o && typeof o === "object" ? o : {}
  const feed: CeneoFeedOptions = opts.feed && typeof opts.feed === "object" ? opts.feed : {}
  const reviews: CeneoReviewsOptions = opts.reviews && typeof opts.reviews === "object" ? opts.reviews : {}

  const token = str(feed.token)
  const tokenOk = token !== null && FEED_TOKEN_PATTERN.test(token)
  const productUrl = str(feed.productUrl)
  const productUrlOk = productUrl !== null && isProductUrlTemplate(productUrl)
  const guid = str(reviews.accountGuid)
  const guidOk = guid !== null && ACCOUNT_GUID_PATTERN.test(guid)
  const workDays = num(reviews.workDays)
  const demo = bool(opts.demo)
  const writes: CeneoWritesOptions = opts.writes && typeof opts.writes === "object" ? opts.writes : {}
  const orders: CeneoOrdersOptions = opts.orders && typeof opts.orders === "object" ? opts.orders : {}
  const carrier = num(orders.carrierId)
  const cpc: CeneoCpcOptions = opts.cpc && typeof opts.cpc === "object" ? opts.cpc : {}
  const maxBid = typeof cpc.maxBid === "string" ? Number(cpc.maxBid.trim().replace(",", ".")) : num(cpc.maxBid)

  return {
    demo,
    feed: {
      token: tokenOk ? token : null,
      tokenRejected: token !== null && !tokenOk,
      productUrl: productUrlOk ? productUrl : null,
      productUrlRejected: productUrl !== null && !productUrlOk,
      regionId: str(feed.regionId),
      salesChannelId: str(feed.salesChannelId),
      offerId: isOfferIdSource(feed.offerId) ? feed.offerId : "variant_id",
      inStockAvail: avail(feed.inStockAvail, 1),
      backorderAvail: avail(feed.backorderAvail, 7),
      outOfStock: feed.outOfStock === "check" ? "check" : "skip",
      intervalMinutes: clampInt(feed.intervalMinutes, 30, 5, 1440),
      includeUnmapped: feed.includeUnmapped === false || feed.includeUnmapped === "false" ? false : true,
      brand: resolveBrand(feed.brand),
    },
    reviews: {
      accountGuid: guidOk ? guid.toLowerCase() : null,
      accountGuidRejected: guid !== null && !guidOk,
      workDays: Number.isInteger(workDays) && workDays >= 0 && workDays <= 21 ? workDays : null,
    },
    apiKey: str(opts.apiKey),
    timeoutMs: clampInt(opts.timeoutMs, 15_000, 1000, 60_000),
    writes: Object.fromEntries(WRITER_KEYS.map((k) => [k, writes[k] === undefined ? demo : bool(writes[k])])) as Record<WriterKey, boolean>,
    orders: {
      importStates: ints(orders.importStates) ?? (demo ? [101, 102] : []),
      canceledStates: ints(orders.canceledStates) ?? (demo ? [103] : []),
      paidPaymentTypes: ints(orders.paidPaymentTypes) ?? [],
      shippingOptionId: str(orders.shippingOptionId),
      carrierId: Number.isInteger(carrier) && carrier > 0 ? carrier : demo ? 1 : null,
      cancelReason: (str(orders.cancelReason) ?? "Zamówienie anulowane przez sklep").slice(0, 200),
    },
    cpc: {
      maxBid: Number.isFinite(maxBid) && maxBid > 0 && maxBid <= 1000 ? Math.round(maxBid * 100) : demo ? 200 : null,
      maxBidChangePercent: clampInt(cpc.maxBidChangePercent, 50, 1, 1000),
      perRun: clampInt(cpc.perRun, 300, 10, 3000),
      shopName: str(cpc.shopName),
    },
  }
}

/**
 * What the feed still needs before it can be served, in the order the
 * setup guide asks for it. An empty list: the feed is ready.
 */
export type FeedGap = "token" | "token_rejected" | "product_url" | "product_url_rejected"

export function feedGaps(o: ResolvedCeneoOptions): FeedGap[] {
  const gaps: FeedGap[] = []
  if (o.feed.tokenRejected) gaps.push("token_rejected")
  else if (!o.feed.token) gaps.push("token")
  if (o.feed.productUrlRejected) gaps.push("product_url_rejected")
  else if (!o.feed.productUrl) gaps.push("product_url")
  return gaps
}
