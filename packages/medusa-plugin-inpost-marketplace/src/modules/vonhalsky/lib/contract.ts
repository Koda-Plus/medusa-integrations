/**
 * The shapes the admin routes answer. Shared with the admin (type imports
 * only), so a change here is checked on both sides by the typecheck.
 */

import type { CaseKind, ImportStatus, OfferStatus, TrackingStatus } from "./constants"
import type { BlockingReason, WarningCode } from "./eligibility"
import type { VonHalskyMode } from "./options"
import type { ShippingMapping } from "./shipping"

export type OfferFilter = "all" | "listed" | "draft" | "blocked" | "closed" | "pending"
export type OrderFilter = "all" | "awaiting_shipment" | "tracking_waiting" | "held" | "errors"
export type CaseFilter = "all" | "open" | CaseKind

export interface VonHalskySettings {
  pricing: { markupPercent: number }
  orders: { salesChannelId: string | null; regionId: string | null; autoImport: boolean }
  shipping: ShippingMapping
  /** Medusa category id to a marketplace leaf category id. */
  categories: Record<string, string>
  offerDefaults: OfferDefaults
}

/** What every offer needs and Medusa does not keep. */
export interface OfferDefaults {
  /** 0 to 60. */
  daysToShip: number
  /** Shown on the offer (the marketplace's `postSale`). Empty: the marketplace's own rules. */
  returnPolicy: string
  complaintPolicy: string
  /** Send the price and stock of listed offers on every sync. */
  syncPriceStock: boolean
}

export interface PromotionDto {
  start: string | null
  end: string | null
  status: string | null
  mode: "PERCENTAGE" | "FIXED_PRICE" | "AMOUNT" | null
  value: number | null
}

export interface OfferDto {
  id: string
  variant_id: string
  product_id: string
  sku: string | null
  title: string | null
  thumbnail: string | null
  status: OfferStatus
  remote_status: string | null
  remote_id: string | null
  ean: string | null
  brand: string | null
  mpn: string | null
  manufacturer: string | null
  gpsr_source: "compliance" | "metadata" | null
  reasons: BlockingReason[]
  warnings: WarningCode[]
  /** Prices as "49.99" strings, gross, in `currency_code`. */
  base_price: string | null
  price_override: string | null
  price: string | null
  currency_code: string
  stock: number
  demo: boolean
  listed_at: string | null
  synced_at: string | null
  error: string | null
  category_id: string | null
  /** "Dom i ogród > Meble > Krzesła", when the category is known. */
  category_path: string | null
  category_source: "map" | "hint" | "manual" | null
  hint: { productId: string | null; categoryId: string | null; name: string | null; brand: string | null } | null
  /** The marketplace's own numbers: the regular price, what a buyer pays now (promotion, price program) and the stock. */
  remote_price: string | null
  remote_final_price: string | null
  remote_stock: number | null
  promotion: PromotionDto | null
  program: "IN" | "OUT" | null
  validation: Array<{ code: string; message: string | null }>
  /** The last asynchronous write and where it stands. */
  command: { id: string; kind: string; status: "PENDING" | "SUCCESS" | "FAILURE"; at: string | null } | null
  image_count: number | null
  published_at: string | null
  /** The category parameters saved for this offer (sent with the next listing). */
  attributes: Array<{ id: string; values: string[] }>
}

export interface OffersResponse {
  offers: OfferDto[]
  count: number
  offset: number
  limit: number
}

export interface EventDto {
  at: string
  kind: string
  message: string
  demo?: boolean
}

export interface OrderLineDto {
  offer_id: string
  variant_id: string
  sku: string | null
  title: string
  quantity: number
  unit_price: string | null
}

export interface ParcelDto {
  trackingNumber: string
  createdAt: string | null
  status: string | null
}

export interface MarketplaceOrderDto {
  id: string
  marketplace_order_id: string
  status: ImportStatus
  remote_status: string | null
  order_id: string | null
  display_id: number | null
  demo: boolean
  delivery_type: string | null
  delivery_point: string | null
  shipping_option_id: string | null
  payment_type: string | null
  currency_code: string
  total: string | null
  lines: OrderLineDto[]
  tracking_status: TrackingStatus
  /** Medusa's tracking numbers of this order. */
  tracking_numbers: string[]
  /** The parcels the marketplace shows. */
  parcels: ParcelDto[]
  imported_at: string | null
  placed_at: string | null
  paid_at: string | null
  shipped_at: string | null
  expected_delivery_at: string | null
  buyer_kind: string | null
  delivery: string | null
  refunded: string | null
  returns_count: number
  claims_count: number
  error: string | null
  events: EventDto[]
  created_at: string
  updated_at: string
}

export interface OrdersResponse {
  orders: MarketplaceOrderDto[]
  count: number
  offset: number
  limit: number
}

export interface CaseLineDto {
  offerId: string | null
  name: string | null
  ean: string | null
  quantity: number
  price: string | null
  reason: string | null
}

export interface CaseDto {
  id: string
  kind: CaseKind
  remote_id: string
  display_id: string | null
  marketplace_order_id: string | null
  /** The Medusa order of that marketplace order, when imported. */
  order_id: string | null
  display_order_id: number | null
  status: string | null
  sub_status: string | null
  source: string | null
  reason: string | null
  amount: string | null
  lines: CaseLineDto[]
  refund_id: string | null
  opened_at: string | null
  expires_at: string | null
  decided_at: string | null
  /** The seller has to act (a new return, an open claim, a declined refund payment). */
  open: boolean
  demo: boolean
  events: EventDto[]
}

export interface CasesResponse {
  cases: CaseDto[]
  count: number
  offset: number
  limit: number
}

/** One case read live: the buyer's contact data are shown, never stored. */
export interface CaseDetailResponse {
  case: CaseDto
  contact: { name: string | null; email: string | null; phone: string | null } | null
  /** Reasons a return may be rejected with. */
  rejectReasons: Array<{ id: string; code: string; description: string | null }>
}

export interface CategoryDto {
  id: string
  name: string
  path: string
  depth: number
  leaf: boolean
  gpsr_free: boolean
}

export interface CategoriesResponse {
  categories: CategoryDto[]
  count: number
  synced_at: string | null
}

export interface AttributeDto {
  id: string
  name: string
  type: string
  required: boolean
  /** More than one value allowed (AT_LEAST_ONE, ANY). */
  multiple: boolean
  options: Array<{ id: string; value: string }>
  unit: string | null
}

export interface AttributesResponse {
  category: CategoryDto | null
  attributes: AttributeDto[]
}

/** Medusa categories with the marketplace leaf each is mapped to. */
export interface CategoryMapResponse {
  medusa: Array<{ id: string; name: string; path: string; mapped: CategoryDto | null }>
}

export interface HintDto {
  productId: string | null
  name: string | null
  brand: string | null
  categoryId: string | null
  categoryPath: string | null
  ean: string | null
  mpn: string | null
  attributes: number
}

export interface HintResponse {
  hints: HintDto[]
}

/** The parts of the sync (the job and "Sync now") and what each answered. */
export type SyncPart = "commands" | "offers" | "push" | "orders" | "cases" | "categories" | "snapshot"
export type SyncReport = Partial<Record<SyncPart, { ok: boolean; detail: string }>>

/** A promotion as POST /offers/promotion takes it: ISO dates. */
export type PromotionMode = "PERCENTAGE" | "FIXED_PRICE" | "AMOUNT"
export interface PromotionInput {
  mode: PromotionMode
  value: number
  start: string
  end: string
}

/** How a claim is answered. */
export type ClaimResolution = "reject" | "partial" | "full"

export interface StatsResponse {
  /** The window in days (7, 30, 90). */
  days: number
  from: string
  currency: string
  revenue: {
    /** Gross revenue of marketplace orders placed in the window (imported or not, cancelled left out). */
    vonhalsky: string
    orders: number
    aov: string | null
    /** Every other sales channel of Medusa, orders placed in the window. */
    otherChannels: Array<{ id: string; name: string; revenue: string; orders: number }>
    daily: Array<{ day: string; revenue: string; orders: number }>
  }
  offers: {
    byStatus: Record<string, number>
    listed: number
    /** Listed offers without a sale in the window. */
    noSales: number
    noSalesSample: Array<{ id: string; title: string | null; sku: string | null; stock: number }>
    /** Units sold over units sold plus units in stock, percent. */
    sellThrough: number | null
    withPromotion: number
    inProgram: number
    pending: number
    rejected: number
    /** The most common validation codes of pending or rejected offers. */
    topValidation: Array<{ code: string; message: string | null; count: number }>
    /** From the daily snapshots. */
    history: Array<{ day: string; published: number; pending: number; soldout: number; closed: number }>
  }
  products: Array<{ offer_id: string; title: string | null; sku: string | null; units: number; revenue: string; returns: number; claims: number }>
  fulfilment: {
    /** Hours from payment to the first parcel. */
    toShipHours: { median: number | null; p90: number | null; count: number }
    /** Hours from the first parcel to the delivery date the marketplace gave. */
    toDeliveryHours: { median: number | null; count: number }
    /** Paid longer ago than the days to ship and still without a parcel. */
    late: number
  }
  mix: {
    delivery: Record<string, number>
    payment: Record<string, number>
    buyer: Record<string, number>
  }
  discounts: {
    /** What buyers saved through promotions and the price program. */
    promotion: string
    program: string
    /** Revenue (delivery left out) and units of orders with a discounted line. */
    discountedRevenue: string
    discountedUnits: number
  }
  afterSale: {
    returns: number
    claims: number
    refunds: number
    refunded: string
    /** Orders with a return or a claim over orders, percent. */
    returnRate: number | null
    claimRate: number | null
    topReasons: Array<{ reason: string; count: number }>
  }
  /** What the seller API does not expose; the panel says so instead of guessing. */
  notAvailable: string[]
}

export interface LogDto {
  id: string
  area: string
  action: string
  outcome: "ok" | "warning" | "error"
  message: string
  count: number | null
  demo: boolean
  created_at: string
}

export interface LogResponse {
  entries: LogDto[]
  count: number
}

export interface OptionLite {
  id: string
  name: string
}

export interface Counts {
  offers: number
  listed: number
  draft: number
  blocked: number
  closed: number
  /** Offers the marketplace keeps PENDING or REJECTED. */
  pending: number
  orders: number
  awaiting_shipment: number
  tracking_waiting: number
  held: number
  errors: number
  /** Offers with a write the marketplace has not finished. */
  commands_pending: number
  /** After sale cases waiting for the seller. */
  cases_open: number
}

export interface StatusResponse {
  mode: VonHalskyMode
  configured: boolean
  demo: boolean
  environment: "sandbox" | "live"
  missing: string[]
  problems: string[]
  options: {
    apiUrl: string
    tokenUrl: string
    organizationId: string
    /** Masked: "***" and the last four characters. */
    clientId: string
    clientSecret: string
    vatRate: number
    pricesIncludeTax: boolean | null
    /** What the plugin uses now: the option, else the PLN price preference. */
    pricesIncludeTaxNow: boolean
    brandKey: string
    mpnKey: string
    eanKey: string
    dimensionUnit: "mm" | "cm"
    weightUnit: "g" | "kg"
  }
  settings: VonHalskySettings
  /** Where imported orders land now (the setting, the option or the default). */
  target: { salesChannel: OptionLite | null; region: (OptionLite & { currency: string }) | null; channelNote: string | null }
  shippingOptions: Array<OptionLite & { provider_id: string | null }>
  salesChannels: OptionLite[]
  regions: Array<OptionLite & { currency: string }>
  /** The EU Compliance plugin is installed: GPSR manufacturers come from it first. */
  compliance: boolean
  counts: Counts
  lastSyncAt: string | null
  /** The last rate limit headers of the seller API (sandbox and live). */
  limits: { limit: number | null; remaining: number | null; resetAt: string | null } | null
  categories: { count: number; syncedAt: string | null }
}

/** The answer of the credentials check. */
export interface CheckResponse {
  ok: boolean
  organization: string | null
  message: string | null
}

export interface OrderOriginResponse {
  configured: boolean
  order: MarketplaceOrderDto | null
}
