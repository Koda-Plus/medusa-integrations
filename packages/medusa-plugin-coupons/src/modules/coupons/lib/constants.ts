/**
 * Constants of Coupons by Koda Plus. Zero Medusa imports.
 *
 * The module key is `koda_coupons`, never `coupons` or `promotion`: a store
 * may already have a module of its own under a short name, and Medusa keeps
 * one module per key (the app's silently wins).
 */
export const COUPONS_MODULE = "koda_coupons"

/** At most this many promotions on the list page (the newest first). */
export const LIST_LIMIT = 300

/** "Expiring soon" on the board: an end date within this many days. */
export const EXPIRING_DAYS = 7

/** Orders shown on a coupon's detail. */
export const DETAIL_ORDERS = 25

/** Attributes the plugin reads in promotion rules. */
export const RULE = {
  groups: "customer.groups.id",
  customer: "customer.id",
  customerAlt: "customer_id",
  currency: "currency_code",
  minimum: "item_total",
  category: "items.product.categories.id",
  product: "items.product.id",
  /**
   * One variant of a line. With "ne" it leaves single products out of a
   * discount on the store's pools: Medusa joins target rules with AND, and
   * "ne" on a list holds when the line's variant is none of them.
   */
  variant: "items.variant_id",
  collection: "items.product.collection_id",
  tag: "items.product.tags.id",
  shippingType: "shipping_methods.shipping_option.shipping_option_type_id",
  shippingOption: "shipping_methods.shipping_option_id",
  salesChannel: "sales_channel_id",
  region: "region_id",
} as const

/** Allocation "each" needs a ceiling of pieces per line; this one never limits a real cart. */
export const EACH_MAX_QUANTITY = 999

/** Rule attributes that mean an order minimum (the creator writes item_total). */
export const MINIMUM_ATTRIBUTES = ["item_total", "subtotal", "original_item_total", "item_subtotal"]
