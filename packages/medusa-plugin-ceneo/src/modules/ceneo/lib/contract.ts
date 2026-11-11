/**
 * The shapes the admin API answers with, shared by the routes and the admin
 * bundle. Types only, no runtime imports.
 */
import type { Avail, BrandSource, OfferIdSource, OfferState, OutOfStockMode, ProblemCode } from "./constants"
import type { FeedGap } from "./options"

export type FeedBuildStatus = "built" | "failed"

export interface FeedBuildDto {
  id: string
  status: FeedBuildStatus
  hash: string | null
  bytes: number
  offers: number
  warnings: number
  errors: number
  excluded: number
  duration_ms: number
  error: string | null
  trigger: string
  built_at: string
  demo: boolean
}

/** How the Ceneo API answers with these options. */
export type ApiMode = "live" | "demo" | "missing_key"

export type OfferCounts = Record<OfferState, number> & { offers: number }

export interface StatusResponse {
  demo: boolean
  feed: {
    /** `/ceneo/feed/<token>.xml` on the backend, or null without a valid token. */
    path: string | null
    gaps: FeedGap[]
    productUrl: string | null
    regionId: string | null
    salesChannelId: string | null
    offerId: OfferIdSource
    inStockAvail: Avail
    backorderAvail: Avail
    outOfStock: OutOfStockMode
    intervalMinutes: number
    includeUnmapped: boolean
    brand: { from: BrandSource; key: string | null } | null
    /** The newest successful build: the file Ceneo gets. */
    last: FeedBuildDto | null
    /** The newest build, when it failed after the last successful one. */
    failed: FeedBuildDto | null
  }
  reviews: { configured: boolean; rejected: boolean; workDays: number | null; stats: ReviewStats }
  api: { mode: ApiMode; timeoutMs: number }
  counts: OfferCounts
  categories: CategoryStats
  orders: OrderStats
}

/** Kup Teraz orders in the table. */
export interface OrderStats {
  total: number
  /** Orders with an item no variant has (by the feed offer id). */
  unmatched: number
  lastSyncedAt: string | null
}

export type OrderSyncResult =
  | { status: "synced"; read: number; created: number; updated: number; unmatched: number; deferred: number; truncated: boolean; demo: boolean; duration_ms: number }
  | { status: "failed"; error: string; status_code: number | null; duration_ms: number }
  | { status: "skipped"; reason: "running" }
  | { status: "off"; reason: "missing_key" }

export type ApiCheckResult =
  | { ok: true; mode: "live" | "demo"; limits: import("./kup-teraz").ApiLimit[]; limitsError?: string }
  | { ok: false; mode: "live" | "missing_key"; error: string; status_code?: number | null }

export interface CeneoOrderItemDto {
  shopProductId: string | null
  name: string | null
  price: number | null
  quantity: number
  total: number | null
  returned: number
  variantId: string | null
}

export interface CeneoOrderDto {
  id: string
  ceneoOrderId: string
  number: string | null
  shopOrderId: string | null
  stateId: number | null
  state: string | null
  orderedAt: string | null
  amounts: { order: number | null; products: number | null; delivery: number | null }
  deliveryForm: string | null
  items: CeneoOrderItemDto[]
  matched: boolean
  problems: Array<{ code: string; detail?: string }>
  medusaOrderId: string | null
  demo: boolean
  syncedAt: string | null
}

export interface CeneoOrdersResponse {
  orders: CeneoOrderDto[]
  count: number
  limit: number
  offset: number
}

/** The order with the data Ceneo keeps (read now, not stored). */
export interface CeneoOrderDetailResponse {
  order: CeneoOrderDto
  remark: string | null
  shipping: Record<string, unknown> | null
  invoice: Record<string, unknown> | null
  pickup: Record<string, unknown> | null
  services: Record<string, unknown>[]
  /** Why the Ceneo part is missing (the key, a Ceneo error); the stored part is still shown. */
  detailError: string | null
}

/** Zaufane Opinie over the last 30 days (no personal data, counts only). */
export interface ReviewStats {
  /** Carts with an answer to the survey checkbox. */
  answers: number
  /** Of these, the shopper agreed to the survey. */
  agreed: number
  /** Orders whose transaction the confirmation page fetched. */
  transactions: number
}

/** GET /store/ceneo/transaction: `transaction` goes as is to `_ceneo('transaction', ...)`. */
export interface CeneoTransactionResponse {
  account_guid: string
  /** The Medusa order id: compare it with the confirmation page's order before sending. */
  order_id: string
  survey: boolean
  transaction: import("./transaction").CeneoTransaction
}

/** The Ceneo tree in the table and how much of the Medusa tree is mapped. */
export interface CategoryStats {
  /** Active Ceneo categories in the table; 0 before the first sync. */
  tree: number
  syncedAt: string | null
  /** Medusa categories with their own mapping. */
  mapped: number
}

export type CategorySyncResult =
  | { status: "synced"; categories: number; created: number; updated: number; removed: number; duration_ms: number }
  | { status: "failed"; error: string; duration_ms: number }
  | { status: "skipped"; reason: "running" }

export interface CeneoCategoryDto {
  ceneoId: string
  name: string
  path: string
  leaf: boolean
  active: boolean
}

export interface CeneoCategorySearchResponse {
  categories: CeneoCategoryDto[]
}

/** One Medusa category with its mapping. */
export interface CategoryMapRow {
  id: string
  name: string
  path: string
  depth: number
  /** Internal or inactive in Medusa: its name never reaches Ceneo, a mapping still applies. */
  hidden: boolean
  /** Its own mapping. */
  own: CeneoCategoryDto | null
  /** The mapping that applies (its own or a parent's). */
  effective: { ceneo: CeneoCategoryDto | null; ceneoId: string; fromCategoryId: string; inherited: boolean } | null
}

export interface CategoryMapResponse {
  categories: CategoryMapRow[]
  stats: CategoryStats
}

export interface OfferProblemDto {
  code: ProblemCode
  detail?: string
}

export interface OfferDto {
  id: string
  offerId: string | null
  variantId: string
  productId: string
  sku: string | null
  title: string
  state: OfferState
  problems: OfferProblemDto[]
  inFeed: boolean
  price: { amount: number; currency_code: string } | null
  avail: number | null
  stock: number | null
  ceneoCategoryId: string | null
  builtAt: string
  /** The id another variant holds can be taken over (that variant is gone or retired its row). */
  canTakeOver: boolean
}

export interface OffersResponse {
  offers: OfferDto[]
  count: number
  limit: number
  offset: number
}

export interface ProductCeneoResponse {
  offers: OfferDto[]
  category: { ceneo: CeneoCategoryDto | null; fromCategoryId: string } | null
}

/** What started a feed build. */
export type FeedTrigger = "schedule" | "first" | "change" | "manual"

/** The answer of a feed build (`POST /admin/ceneo/feed`, the workflow). */
export type FeedBuildResult =
  | { status: "skipped"; reason: "gaps"; gaps: FeedGap[] }
  | { status: "skipped"; reason: "running" }
  | { status: "built"; id: string; changed: boolean; bytes: number; duration_ms: number; offers: number; warnings: number; errors: number; excluded: number }
  | { status: "failed"; id: string; error: string; code: string | null; duration_ms: number }
