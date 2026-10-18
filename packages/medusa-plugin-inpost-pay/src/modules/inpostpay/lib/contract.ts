import type { BasketStatus, BindingPlace, DeliveryType, InpostPayModeValue } from "./types"

/** The shapes the routes answer with (snake case, like Medusa's own API). */

export interface BasketEventDto {
  at: string
  /** bound, linked, rejected, ordered, failed, unbound, payment, order_event, basket_event, sent, note */
  kind: string
  message: string
  demo?: boolean
  data?: Record<string, unknown>
}

export interface BasketDto {
  id: string
  cart_id: string
  status: BasketStatus
  demo: boolean
  masked_phone: string | null
  order_id: string | null
  display_id: number | null
  delivery_type: DeliveryType | null
  delivery_point: string | null
  payment_status: string | null
  payment_type: string | null
  order_status: string | null
  currency_code: string | null
  /** The order or cart total in major units ("199.99"), when known. */
  total: string | null
  binding_place: BindingPlace | null
  error: string | null
  linked_at: string | null
  ordered_at: string | null
  created_at: string
  updated_at: string
  events: BasketEventDto[]
}

export interface DeliveryMapping {
  APM: string | null
  COURIER: string | null
  DIGITAL: string | null
}

/** Where the storefront shows the button (read by the storefront from GET /store/inpostpay/config). */
export interface Placements {
  product: boolean
  cart: boolean
  minicart: boolean
  checkout: boolean
  thank_you: boolean
}

export interface InpostPaySettings {
  delivery: DeliveryMapping
  placements: Placements
}

export interface ShippingOptionLite {
  id: string
  name: string
  provider_id: string | null
}

export type BasketFilter = "all" | BasketStatus | "payment_problems"

export interface StatusResponse {
  mode: InpostPayModeValue
  configured: boolean
  demo: boolean
  sandbox: boolean
  missing: string[]
  problems: string[]
  options: {
    clientId: string
    clientSecret: string
    merchantClientId: string
    posId: string
    paymentProviderId: string
    storefrontUrl: string | null
    sendOrderEvents: boolean
    basketTtlHours: number
  }
  urls: {
    /** What goes into the merchant portal as the Merchant Backend API address. */
    merchantApi: string
    api: string
    widget: string
  }
  settings: InpostPaySettings
  provider: { id: string; registered: boolean; enabled: boolean }
  shippingOptions: ShippingOptionLite[]
  counts: {
    baskets: number
    linked: number
    orders: number
    failed: number
    payment_problems: number
    /** Orders per bound basket, 0 to 100 (whole percent). */
    conversion: number
  }
  lastEventAt: string | null
}

export interface BasketsResponse {
  baskets: BasketDto[]
  count: number
  offset: number
  limit: number
}

export interface OrderInpostPayResponse {
  mode: InpostPayModeValue
  configured: boolean
  basket: BasketDto | null
}

/** What the storefront reads before it shows the button. */
export interface StoreConfigResponse {
  enabled: boolean
  mode: InpostPayModeValue
  demo: boolean
  /** Public: the widget is initialised with it. Null in demo mode. */
  merchant_client_id: string | null
  /** InPost's widget script; null in demo mode (the demo has no widget, the storefront draws its own button). */
  widget_script_url: string | null
  placements: Placements
  language: "pl" | "en"
}

/** The answer of POST /store/inpostpay/baskets. */
export interface StoreBasketResponse {
  basket: {
    id: string
    status: BasketStatus
    demo: boolean
    masked_phone: string | null
    order_id: string | null
    payment_status: string | null
  }
  /** What InPostPayWidget.init needs: `basketBindingApiKey`. Null in demo mode. */
  widget: { merchant_client_id: string; basket_binding_api_key: string; script_url: string } | null
}
