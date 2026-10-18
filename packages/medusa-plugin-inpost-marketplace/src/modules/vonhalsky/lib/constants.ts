/** The module key in the container: `vonhalsky`. */
export const VONHALSKY_MODULE = "vonhalsky"

/** The marketplace's name as the admin shows it. */
export const MARKETPLACE_NAME = "InPost Von Halsky"

/**
 * Where InPost publishes what an integrator needs. Access to the seller API
 * is limited to known integrators (an agreement with InPost); the public
 * PHP SDK names the operations and models this plugin is shaped after.
 */
export const API_PORTAL_URL = "https://inpsa-api-portal.inpost-group.com/"
export const PUBLIC_SDK_URL = "https://github.com/InPost-VonHalsky/InPost-vonHalsky-api-sdk-php"

/**
 * The life of one offer row in this plugin:
 *   draft    built from a Medusa variant, not on the marketplace (yet)
 *   listed   on the marketplace (demo: marked listed in our table)
 *   blocked  cannot be listed: `reasons` says what is missing
 *   closed   taken off the marketplace by a person
 */
export const OFFER_STATUSES = ["draft", "listed", "blocked", "closed"] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

/**
 * The offer statuses of the marketplace itself, as the public SDK's
 * `OfferStatus` model lists them. Kept on the row as `remote_status`.
 */
export const REMOTE_OFFER_STATUSES = ["PENDING", "REJECTED", "PUBLISHED", "CLOSED", "SOLDOUT"] as const

/** The order statuses of the marketplace (the SDK's `OrderStatus`). */
export const REMOTE_ORDER_STATUSES = ["CREATED", "ACCEPTED", "REFUSED", "REJECTED", "CANCELED", "UNKNOWN"] as const

/** Delivery types of a marketplace order (the SDK's `DeliveryMethodType`): a parcel locker or a courier. */
export const DELIVERY_TYPES = ["APM", "COURIER"] as const
export type DeliveryType = (typeof DELIVERY_TYPES)[number]

/** Payment types a marketplace order carries (the SDK's `PaymentType`). */
export const PAYMENT_TYPES = ["CARD", "CARD_TOKEN", "GOOGLE_PAY", "APPLE_PAY", "BLIK_CODE", "BLIK_TOKEN", "PAY_BY_LINK", "SHOPPING_LIMIT", "DEFERRED_PAYMENT", "CASH_ON_DELIVERY", "UNKNOWN"] as const

/**
 * The life of one marketplace order row in this plugin:
 *   imported  the Medusa order exists (`order_id`)
 *   held      it could not be imported; `error` says why, a person fixes it and retries
 *   importing an attempt is running (or died: the next attempt looks at `order_id` first)
 */
export const ORDER_STATUSES = ["importing", "imported", "held"] as const
export type ImportStatus = (typeof ORDER_STATUSES)[number]

/** Tracking sent back to the marketplace: nothing yet, sent, failed (retried by a person), waiting for the live API. */
export const TRACKING_STATUSES = ["none", "sent", "failed", "pending_api"] as const
export type TrackingStatus = (typeof TRACKING_STATUSES)[number]

/** Every setting key stored in the `vonhalsky_setting` table. */
export const SETTING_KEYS = {
  pricing: "pricing",
  orders: "orders",
  shipping: "shipping",
} as const

/** The demo sales channel, created on the first simulated order. */
export const DEMO_SALES_CHANNEL = "InPost Von Halsky (demo)"

/** The key every marketplace importer of Koda Plus writes on the Medusa order (BaseLinker and Allegro do too). */
export const MARKETPLACE_REF_KEY = "marketplace_order_ref"
export const marketplaceRef = (id: string): string => `vonhalsky:${id}`

/** A demo order carries this metadata key (the demo host filters on it). */
export const DEMO_ORDER_MARKER = "koda_demo"

/** At most this many events are kept on one order row (the newest win). */
export const MAX_EVENTS = 40
/** Sync log rows older than this are pruned when new ones are written. */
export const LOG_KEEP_DAYS = 30
