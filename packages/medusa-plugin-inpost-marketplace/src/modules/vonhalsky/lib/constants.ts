/** The module key in the container: `vonhalsky`. */
export const VONHALSKY_MODULE = "vonhalsky"

/** The marketplace's name as the admin shows it. */
export const MARKETPLACE_NAME = "InPost Von Halsky"

/**
 * Where InPost publishes the seller API (OpenAPI, guidelines, FAQ) and its
 * public PHP SDK. A seller creates the API application in the Merchant
 * Portal (Integrations, API).
 */
export const API_PORTAL_URL = "https://inpsa-api-portal.inpost-group.com/"
export const PUBLIC_SDK_URL = "https://github.com/InPost-VonHalsky/InPost-vonHalsky-api-sdk-php"

/**
 * The life of one offer row in this plugin:
 *   draft    built from a Medusa variant, not on the marketplace (yet)
 *   listed   on the marketplace (demo: marked listed in our table)
 *   blocked  cannot be listed: `reasons` says what is missing
 *   closed   taken off the marketplace by a person
 *   detached removed from this panel only: the marketplace offer stays as it
 *            is (still active on InPost), the plugin forgets its id and the
 *            sync never touches it again until it is listed or imported again
 */
export const OFFER_STATUSES = ["draft", "listed", "blocked", "closed", "detached"] as const
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

/**
 * Medusa's tracking numbers against the marketplace's parcels (the seller
 * API takes no number: a ShipX shipment made with the order's InPost e-mail
 * is linked by InPost): no number yet, numbers the marketplace does not show
 * yet, all of them shown.
 */
export const TRACKING_STATUSES = ["none", "waiting", "linked"] as const
export type TrackingStatus = (typeof TRACKING_STATUSES)[number]

/** Every setting key stored in the `vonhalsky_setting` table. */
export const SETTING_KEYS = {
  pricing: "pricing",
  orders: "orders",
  shipping: "shipping",
  /** Medusa category id to marketplace leaf: { [medusaCategoryId]: remoteCategoryId }. */
  categories: "categories",
  /** What every offer needs and Medusa does not keep: days to ship, return and complaint policy texts. */
  offerDefaults: "offer_defaults",
  /** Where the sync stands: the last event ids seen, the last runs. */
  sync: "sync",
  /** Whether the marketplace still takes the credentials: { failures, since, message, okAt }. */
  connection: "connection",
} as const

/**
 * How often the scheduled sync runs (the cron of `jobs/vonhalsky-sync.ts`
 * says the same). InPost asks integrators to tell sellers how often price
 * and stock are sent and recommends at most every 15 minutes: the admin
 * shows this number next to the time of the last run.
 */
export const SYNC_EVERY_MINUTES = 5

/**
 * Sync runs in a row that the marketplace refused the credentials in before
 * the admin raises the "connection lost" alert: one refusal can be a hiccup
 * of the gateway, two in a row (ten minutes) are not.
 */
export const CONNECTION_ALERT_RUNS = 2

/** After sale case kinds (one table). */
export const CASE_KINDS = ["return", "refund", "claim"] as const
export type CaseKind = (typeof CASE_KINDS)[number]

/**
 * Offer commands the plugin follows. An edit of an offer on the marketplace
 * is one command or three, chained by the sync (a row follows one command at
 * a time):
 *   patch       the merge patch of an offer that is not live (in review,
 *               rejected, or closed by a person): nothing follows it
 *   edit_close  a live offer (PUBLISHED, SOLDOUT) is closed first: InPost's
 *               FAQ says a change other than price and stock may be refused
 *               on a published offer and recommends close, patch, reopen
 *   edit_patch  the merge patch of an offer the plugin closed itself (for an
 *               edit, or at zero stock); a reopen follows, or at zero stock
 *               the offer waits closed like any offer closed for no stock
 */
export const COMMAND_KINDS = ["create", "patch", "edit_close", "edit_patch", "price", "stock", "close", "reopen", "promotion", "program"] as const

/** The command kinds of a close the plugin made itself: the row stays `listed` while the offer is CLOSED. */
export const OWN_CLOSE_KINDS: readonly string[] = ["close", "edit_close", "edit_patch"]
export type CommandKind = (typeof COMMAND_KINDS)[number]

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
