/**
 * The shapes the admin routes answer. Shared with the admin (type imports
 * only), so a change here is checked on both sides by the typecheck.
 */

import type { ImportStatus, OfferStatus, TrackingStatus } from "./constants"
import type { BlockingReason, WarningCode } from "./eligibility"
import type { VonHalskyMode } from "./options"
import type { ShippingMapping } from "./shipping"

export type OfferFilter = "all" | "listed" | "draft" | "blocked" | "closed"
export type OrderFilter = "all" | "awaiting_shipment" | "tracking_sent" | "held" | "errors"

export interface VonHalskySettings {
  pricing: { markupPercent: number }
  orders: { salesChannelId: string | null; regionId: string | null; autoImport: boolean }
  shipping: ShippingMapping
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
  tracking_numbers: string[]
  tracking_sent_at: string | null
  imported_at: string | null
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
  orders: number
  awaiting_shipment: number
  tracking_sent: number
  held: number
  tracking_failed: number
  errors: number
}

export interface StatusResponse {
  mode: VonHalskyMode
  configured: boolean
  demo: boolean
  environment: "sandbox" | "live"
  /** The live seller API client is pending in this version (true in sandbox and live). */
  apiPending: boolean
  missing: string[]
  problems: string[]
  options: {
    apiUrl: string
    organizationId: string
    accessToken: string
    sendTracking: boolean
    vatRate: number
    pricesIncludeTax: boolean | null
    /** What the plugin uses now: the option, else the PLN price preference. */
    pricesIncludeTaxNow: boolean
    brandKey: string
    mpnKey: string
    eanKey: string
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
}

export interface OrderOriginResponse {
  configured: boolean
  order: MarketplaceOrderDto | null
}
