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
  FEED_TOKEN_PATTERN,
  OFFER_ID_SOURCES,
  URL_PLACEHOLDERS,
  isAvail,
  type Avail,
  type OfferIdSource,
  type OutOfStockMode,
} from "./constants"

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
}

export interface CeneoReviewsOptions {
  /** The Zaufane Opinie account GUID, from Panel Ceneo (Opinie, Zaufane Opinie, Instrukcja instalacji). */
  accountGuid?: string
  /** Working days before Ceneo sends the survey, 0 to 21. Default: Ceneo decides (the category average). */
  workDays?: number | string
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
}

export interface ResolvedCeneoOptions {
  demo: boolean
  feed: ResolvedFeedOptions
  reviews: { accountGuid: string | null; accountGuidRejected: boolean; workDays: number | null }
  apiKey: string | null
  timeoutMs: number
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

  return {
    demo: bool(opts.demo),
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
    },
    reviews: {
      accountGuid: guidOk ? guid.toLowerCase() : null,
      accountGuidRejected: guid !== null && !guidOk,
      workDays: Number.isInteger(workDays) && workDays >= 0 && workDays <= 21 ? workDays : null,
    },
    apiKey: str(opts.apiKey),
    timeoutMs: clampInt(opts.timeoutMs, 15_000, 1000, 60_000),
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
