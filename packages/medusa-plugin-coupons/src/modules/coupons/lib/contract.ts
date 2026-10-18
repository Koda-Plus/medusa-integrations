/**
 * What the admin routes of Coupons by Koda Plus answer. Shared by the server
 * and the admin (zero imports). Money is in major units, as Medusa keeps it.
 */

/** Where a coupon stands today. used_up: its limit of uses is reached. */
export type CouponStatus = "active" | "scheduled" | "expired" | "paused" | "draft" | "used_up"

/** What a coupon gives, as the creator and the plain sentence know it. */
export type CouponKind = "percent_order" | "fixed_order" | "free_shipping" | "percent_shipping" | "fixed_shipping" | "percent_items" | "fixed_items" | "buy_get" | "other"

/** A rule the sentence has no words of its own for, shown as it is kept. */
export interface CouponRuleDto {
  /** order: who and what order may use it; target: what the discount lands on. */
  scope: "order" | "target"
  attribute: string
  operator: string
  values: string[]
}

/** A promotion read back into the creator's terms. */
export interface CouponShape {
  kind: CouponKind
  /** The percent (1 to 100) or the amount, null when there is none. */
  value: number | null
  currency: string | null
  /** Category ids the discount is limited to. */
  categoryIds: string[]
  /** Product ids the discount is limited to. */
  productIds: string[]
  /** Product collection ids the discount is limited to. */
  collectionIds: string[]
  /** Shipping option types (or options) the delivery discount is limited to. */
  shippingTypeIds: string[]
  shippingOptionIds: string[]
  /** Sales channels and regions the coupon works in; empty: all. */
  salesChannelIds: string[]
  regionIds: string[]
  /** Customer group ids the coupon is for; empty: every group. */
  groupIds: string[]
  /** Customer ids the coupon is for; empty: anyone. */
  customerIds: string[]
  /** An order minimum (item total), null when there is none. */
  minimum: number | null
  /** Rules the plain sentence has no words of its own for, listed in it as they are kept. */
  rules: CouponRuleDto[]
  /** How many of them (rules.length), for older readers. */
  otherRules: number
}

export interface CouponStats {
  /** Orders the coupon took part in (canceled ones left out). */
  orders: number
  /** The discount it gave in those orders. */
  discount: number
  /** The totals of those orders. */
  revenue: number
  /** Orders that were the customer's first one in the store. */
  newCustomers: number
  lastUsedAt: string | null
}

export interface CouponDto {
  id: string
  code: string
  automatic: boolean
  status: CouponStatus
  /** Medusa's own status of the promotion. */
  medusaStatus: string
  shape: CouponShape
  startsAt: string | null
  endsAt: string | null
  /** Uses allowed (null: no limit) and used so far, from Medusa. */
  limit: number | null
  used: number
  campaign: { id: string; name: string } | null
  stats: CouponStats
  createdAt: string | null
}

/** Names of the ids the shapes point to, so the admin can say them in words. */
export interface NameMaps {
  groups: Record<string, string>
  categories: Record<string, string>
  products: Record<string, string>
  customers: Record<string, string>
  collections?: Record<string, string>
  shippingTypes?: Record<string, string>
  shippingOptions?: Record<string, string>
  salesChannels?: Record<string, string>
  regions?: Record<string, string>
  /** The store's own rules of its promotions, by promotion id (option storeRules). */
  storeRules?: Record<string, { text: string; replacesDiscount?: boolean }>
}

export interface CouponTiles {
  active: number
  scheduled: number
  /** Orders with a coupon and their discount in the last 30 days. */
  orders30d: number
  discount30d: number
  /** Active coupons ending within the next 7 days. */
  expiringSoon: number
  /** Active automatic coupons without a group or customer rule. */
  automaticForEveryone: number
}

export interface ListResponse {
  version: string
  currencyCode: string
  codePrefix: string | null
  memberGroupIds: string[]
  problems: string[]
  coupons: CouponDto[]
  names: NameMaps
  tiles: CouponTiles
}

export interface CouponOrderDto {
  id: string
  displayId: number | null
  createdAt: string
  customer: string | null
  discount: number
  total: number
  currency: string
  firstOrder: boolean
}

export interface DetailResponse {
  coupon: CouponDto
  names: NameMaps
  orders: CouponOrderDto[]
}

export interface LookupsResponse {
  groups: Array<{ id: string; name: string; member: boolean }>
  categories: Array<{ id: string; name: string }>
  currencies: string[]
  currencyCode: string
}

export interface CustomerHit {
  id: string
  email: string
  name: string | null
}

/** The three steps of the creator, as the admin sends them. */
export type WizardKind = "percent_order" | "fixed_order" | "free_shipping" | "percent_category"
export type WizardAudience = "everyone" | "groups" | "customer"
export type WizardValidity = "month" | "30d" | "none" | "custom"

export interface WizardInput {
  kind: WizardKind
  /** The percent (1 to 100) or the amount; ignored for free shipping. */
  value?: number | null
  categoryIds?: string[]
  audience: WizardAudience
  groupIds?: string[]
  customerId?: string | null
  /** A code to type at checkout, or automatic (applied by itself to whoever matches). */
  mode: "code" | "automatic"
  code?: string | null
  validity: WizardValidity
  /** ISO dates for validity "custom". */
  startsAt?: string | null
  endsAt?: string | null
  /** Uses allowed in total; null or missing: no limit. */
  limit?: number | null
  /** Order minimum (item total); null or missing: none. */
  minimum?: number | null
  currencyCode?: string | null
}

/**
 * The edit form (POST /admin/coupons/:id with { patch }). A missing key is
 * left as it is; null clears (dates, limit, minimum). Dates are ISO strings.
 */
export interface CouponPatch {
  code?: string
  mode?: "code" | "automatic"
  value?: number | null
  startsAt?: string | null
  endsAt?: string | null
  limit?: number | null
  minimum?: number | null
  groupIds?: string[]
  customerIds?: string[]
}

export interface UpdateResponse {
  coupon: CouponDto
  /** Keys of `edit.warning.<key>`, for what was saved. */
  warnings: string[]
  /** False when the form matched the coupon and nothing was written. */
  changed: boolean
}

export interface CreateResponse {
  coupon: CouponDto
  warnings: string[]
}

/** The customer's card: the codes they used and the coupons made for them or their groups. */
export interface CustomerCouponsResponse {
  used: Array<{ code: string; promotionId: string | null; orders: number; discount: number; lastAt: string | null }>
  forThem: CouponDto[]
  names: NameMaps
  currency: string
}

/** The order's card: which coupons worked and what each gave. */
export interface OrderCouponsResponse {
  applied: Array<{ code: string | null; promotionId: string | null; discount: number; on: "items" | "shipping" }>
  total: number
  currency: string
}

/** The product's card: active coupons that reach this product. */
export interface ProductCouponsResponse {
  coupons: CouponDto[]
  names: NameMaps
}
