/** The module key in the container: `inpostpay`. */
export const INPOSTPAY_MODULE = "inpostpay"

/**
 * The identifier of the payment provider this plugin ships. Registered in
 * the payment module with `id: "inpost-pay"`, Medusa names it
 * `pp_inpost-pay_inpost-pay`.
 */
export const PROVIDER_IDENTIFIER = "inpost-pay"
export const DEFAULT_PROVIDER_ID = "pp_inpost-pay_inpost-pay"

/**
 * InPost's addresses, as the merchant documentation gives them
 * (dokumentacja-inpost.atlassian.net, space PL: "Authorization and Technical
 * Requirements", "InPost Pay (Basket App)", "Widget 2.0").
 */
export const INPOST_URLS = {
  live: {
    api: "https://api.inpost.pl",
    token: "https://login.inpost.pl/auth/realms/external/protocol/openid-connect/token",
    widget: "https://inpostpay-widget-v2.inpost.pl/inpostpay.widget.v2.js",
  },
  sandbox: {
    api: "https://sandbox-api.inpost.pl",
    token: "https://sandbox-login.inpost.pl/auth/realms/external/protocol/openid-connect/token",
    widget: "https://sandbox-inpostpay-widget-v2.inpost.pl/inpostpay.widget.v2.js",
  },
} as const

/** Where InPost's merchant portal and documentation live (for the setup guide). */
export const INPOST_DOCS_URL = "https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/151355427/Scope+of+works+on+the+Merchant+s+side"

/** The headers of a signed call from InPost Pay to the Merchant Backend API. */
export const SIGNATURE_HEADERS = {
  signature: "x-signature",
  timestamp: "x-signature-timestamp",
  keyVersion: "x-public-key-ver",
  keyHash: "x-public-key-hash",
} as const

/** The documentation rejects a signature older (or newer) than 240 seconds. */
export const SIGNATURE_TOLERANCE_SECONDS = 240

/**
 * The life of one basket row in this plugin:
 *   created   the cart was bound (a binding key was issued), the app has not answered yet
 *   linked    the customer confirmed the basket in the app (confirmation SUCCESS)
 *   rejected  the customer refused the binding in the app (confirmation REJECT)
 *   ordered   the order exists in Medusa
 *   failed    creating the order failed (the error says why); a retry may still succeed
 *   unbound   InPost (or the store) removed the binding
 */
export const BASKET_STATUSES = ["created", "linked", "rejected", "ordered", "failed", "unbound"] as const
export type BasketStatus = (typeof BASKET_STATUSES)[number]

/** Payment statuses of InPost Pay ("Order" page of the Basket App documentation). */
export const PAYMENT_STATUSES = ["UNPAID", "STARTED", "PENDING", "AUTHORIZED", "DECLINED", "CANCELLED", "ERROR", "COD"] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** Order statuses of InPost Pay. */
export const ORDER_STATUSES = ["ORDER_PROCESSING", "ORDER_COMPLETED", "ORDER_REJECTED"] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Delivery types of InPost Pay: a parcel locker (APM), the InPost courier, a digital delivery. */
export const DELIVERY_TYPES = ["APM", "COURIER", "DIGITAL"] as const
export type DeliveryType = (typeof DELIVERY_TYPES)[number]

/** Payment types InPost Pay reports with an order. */
export const PAYMENT_TYPES = ["CARD", "CARD_TOKEN", "GOOGLE_PAY", "APPLE_PAY", "BLIK_CODE", "BLIK_TOKEN", "PAY_BY_LINK", "SHOPPING_LIMIT", "DEFERRED_PAYMENT", "CASH_ON_DELIVERY", "FREE_ORDER"] as const

/** Where the widget sits (`binding_place` of the Widget 2.0 placeholder). */
export const BINDING_PLACES = ["PRODUCT_CARD", "BASKET_SUMMARY", "ORDER_CREATE", "BASKET_POPUP", "THANK_YOU_PAGE", "CHECKOUT_PAGE", "MINICART_PAGE", "REGISTERFORM_PAGE", "LOGIN_PAGE"] as const
export type BindingPlace = (typeof BINDING_PLACES)[number]

/** Every setting key stored in the `inpost_pay_setting` table. */
export const SETTING_KEYS = {
  delivery: "delivery",
  placements: "placements",
} as const

/** At most this many events are kept on one basket row (the newest win). */
export const MAX_EVENTS = 50
