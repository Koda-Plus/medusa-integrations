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
  /** Product tag ids the discount is limited to. */
  tagIds?: string[]
  /** Variant ids left out of the discount (target rule items.variant_id "ne"). */
  excludedVariantIds?: string[]
  /** Customer group ids the coupon is for; empty: every group. */
  groupIds: string[]
  /** Customer group ids the coupon is NOT for (rule "is not"): retail only, when they are the member groups. */
  excludedGroupIds?: string[]
  /** Buy X get Y (Medusa's buyget): how many to buy, how many free. */
  buyGet?: { buy: number; free: number } | null
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

/**
 * THE STORE'S OWN TERMS of a coupon, for stores whose cart applies part of a
 * promotion with logic of its own (option `storeTerms`): the store keeps
 * them where it likes, the plugin shows and edits them in the same form.
 * Every key is optional; a key the store does not keep is never sent.
 */
export interface StoreTerms {
  /** What the customer reads next to the code in the store. */
  note?: string | null
  /** The store's product groups (pools) the discount counts on, by id. */
  pools?: string[]
  /** From this many pieces. */
  minQuantity?: number | null
  /** The pieces counted in each pool on its own (true) or all together (false). */
  perPool?: boolean
  /** A percent counted from the price of this price list. */
  basePriceList?: string | null
  /** The price before the discount never lower than in this price list. */
  floorPriceList?: string | null
  /** For every `buy` pieces from one pool `free` pieces free, a free piece costs `freePrice` (null: nothing). */
  buyGet?: { buy: number; free: number; freePrice: number | null } | null
  /** Coupons it adds up with, and coupons it never goes with, by code. */
  combines?: { with: string[]; never: string[] } | null
  /** At most this many orders per customer named in the coupon. */
  perCustomerOrders?: number | null
  /** Works from this cart value, counted before discounts, net or gross. */
  threshold?: { value: number; metric: "net" | "gross" } | null
}

export type StoreFeature = "note" | "pools" | "minQuantity" | "priceLists" | "buyGet" | "combines" | "perCustomerOrders" | "threshold"

export interface StoreLookups {
  features: StoreFeature[]
  /** What the store calls its pools, by language ("Grupy rabatowe"); the admin falls back to its own word. */
  poolsLabel: Record<string, string> | null
  pools: Array<{ id: string; name: string }>
  priceLists: Array<{ id: string; name: string }>
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
  /** The store's own terms (option storeTerms), null when the store keeps none for it. */
  terms?: StoreTerms | null
  /** Who got the code by e-mail from the panel (promotion metadata `code_sent`), oldest first. */
  codeSent?: CodeSentEntry[]
}

/** One e-mail with the code, as kept in the promotion's metadata (`code_sent`). */
export interface CodeSentEntry {
  customer_id: string
  email: string
  /** ISO date of the send. */
  at: string
  /** The admin who sent it (e-mail or user id), null when unknown. */
  by: string | null
}

/** What the panel can do with e-mails of a code (options sendCode, previewCode). */
export interface CodeMailAbility {
  send: boolean
  preview: boolean
}

/** A person the code can go to: from the coupon's customer rule, from earlier sends, or picked now. */
export interface CodeMailRecipientDto {
  customerId: string
  email: string | null
  name: string | null
  /** When she got the code, null: not yet. */
  sentAt: string | null
  /** She is on the coupon's customer rule ("For whom"). */
  inRule: boolean
}

/** GET /admin/coupons/:id/code-mail */
export interface CodeMailResponse {
  ability: CodeMailAbility
  code: string
  /** The coupon has a customer rule: new people are added to it when the code goes out. */
  customerRule: boolean
  /** Why the code cannot be sent now (keys of codeMail.blocker.*), empty: it can. */
  blockers: string[]
  recipients: CodeMailRecipientDto[]
  sent: CodeSentEntry[]
}

/** POST /admin/coupons/:id/code-mail (send) and /code-mail/preview. */
export interface CodeMailInput {
  customerIds: string[]
  message: string
}

export interface CodeMailPreviewResponse {
  subject: string
  html: string
  to: string | null
}

export interface CodeMailSendResponse {
  /** Customer ids the e-mail went to now. */
  sent: string[]
  /** Customer ids that already had it (never sent twice). */
  skipped: string[]
  failed: Array<{ customerId: string; reason: string }>
  /** Customer ids added to the coupon's customer rule before sending. */
  addedToRule: string[]
  /** False when the e-mails went out but the record on the coupon was not saved. */
  recorded: boolean
  coupon: CouponDto
}

/** DELETE /admin/coupons/:id */
export interface DeleteResponse {
  id: string
  code: string
  deleted: true
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
  tags?: Record<string, string>
  pools?: Record<string, string>
  /** Variants left out of a discount: the product title and the variant ("Cream 200 ml"). */
  variants?: Record<string, string>
  priceLists?: Record<string, string>
  /** The value of a customer rule that matches nobody (option nobodyCustomerId). */
  nobody?: string | null
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
  /** E-mails of a code (options sendCode, previewCode); missing from older servers. */
  codeMail?: CodeMailAbility
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
  /** The store's own terms the creator and the edit form offer (option storeTerms), null without them. */
  store: StoreLookups | null
}

/** A product (one variant) of a store's pool, for leaving single products out of a discount. */
export interface PoolProductDto {
  variantId: string
  productId: string
  /** The product's title. */
  title: string
  /** The variant's title, null when the product has only its default variant. */
  variantTitle: string | null
  sku: string | null
  thumbnail: string | null
}

/** GET /admin/coupons/lookups/pool-products?pool=<id>. supported false: the pool's target is not one the plugin can list. */
export interface PoolProductsResponse {
  pool: string
  products: PoolProductDto[]
  supported: boolean
}

export interface CustomerHit {
  id: string
  email: string
  name: string | null
}

/** The three steps of the creator, as the admin sends them. */
export type WizardKind = "percent_order" | "fixed_order" | "free_shipping" | "percent_category" | "percent_pools" | "buy_get"
/**
 * everyone; groups (picked); members: every group named in memberGroupIds
 * (B2B); retail: everyone outside those groups, guests included; customer:
 * one or more chosen customers.
 */
export type WizardAudience = "everyone" | "groups" | "members" | "retail" | "customer"
export type WizardValidity = "month" | "30d" | "none" | "custom"

export interface WizardInput {
  kind: WizardKind
  /** The percent (1 to 100) or the amount; ignored for free shipping and buy X get Y. */
  value?: number | null
  categoryIds?: string[]
  /** The store's pools (percent_pools, and buy_get when the store keeps it). */
  poolIds?: string[]
  /** percent_pools: variants of the picked pools left out of the discount; empty or missing: none. */
  excludedVariantIds?: string[]
  /** Buy X get Y: how many to buy, how many free, the price of a free piece (store only). */
  buyGet?: { buy: number; free: number; freePrice?: number | null } | null
  audience: WizardAudience
  groupIds?: string[]
  customerId?: string | null
  /** More than one customer (audience customer); customerId is the first of them. */
  customerIds?: string[]
  /** The store's own terms besides pools and buy X get Y (option storeTerms). */
  terms?: Pick<StoreTerms, "note" | "minQuantity" | "perPool" | "basePriceList" | "floorPriceList" | "combines" | "perCustomerOrders" | "threshold"> | null
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
  /** Retail only: the coupon is not for these groups (rule "is not"); [] clears it. */
  excludedGroupIds?: string[]
  /** What the discount lands on, for coupons on items: categories, or the store's pools. */
  categoryIds?: string[]
  poolIds?: string[]
  /** A discount on the store's pools: the variants left out of it; [] clears it. */
  excludedVariantIds?: string[]
  /** Buy X get Y kept by Medusa (buyget): how many to buy, how many free. */
  buyGet?: { buy: number; free: number } | null
  /** The store's own terms (option storeTerms): only the keys sent change. */
  terms?: StoreTerms | null
}

/** POST /admin/coupons/:id/duplicate: a copy under a new code, the form's changes on top. */
export interface DuplicateInput {
  code: string
  patch?: CouponPatch
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
