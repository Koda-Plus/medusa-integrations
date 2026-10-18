/**
 * THE MARKETPLACE CLIENT: one interface, two implementations.
 *
 *   demo  `createDemoClient()` in `demo.ts`: in memory, never calls fetch.
 *   live  `createLiveClient()` below: PENDING. Every method throws
 *         `MarketplaceApiPendingError` with a polite message.
 *
 * WHY THE LIVE CLIENT IS PENDING. Access to the InPost Von Halsky seller API
 * is limited to known integrators: the token comes with an agreement with
 * InPost, and the full API documentation lives on InPost's API portal
 * (https://inpsa-api-portal.inpost-group.com/) behind that agreement. A
 * public PHP SDK generated from InPost's OpenAPI file
 * (https://github.com/InPost-VonHalsky/InPost-vonHalsky-api-sdk-php) names
 * the operations and models; this interface and the types of `MarketplaceOrder`
 * follow those models. The operations each method maps to, per the SDK's
 * README, are noted on the method. They are NOT called by this version:
 * request and response bodies, errors and limits have to be checked against
 * the portal and a sandbox account before anything is sent for real.
 */

export type MoneyMinor = { amountMinor: number; currency: string }

export interface MarketplaceAddress {
  street: string | null
  building: string | null
  flat: string | null
  city: string | null
  postCode: string | null
  countryCode: string | null
}

export interface MarketplaceOrderLine {
  /** The marketplace offer id the buyer bought. */
  offerId: string
  /** The seller's own id of the offer (this plugin sends the Medusa variant id). */
  externalId: string | null
  sku: string | null
  ean: string | null
  name: string
  quantity: number
  unitPriceMinor: number
}

/** A marketplace order, normalized from the SDK's `Order` model. */
export interface MarketplaceOrder {
  id: string
  /** CREATED, ACCEPTED, REFUSED, REJECTED, CANCELED, UNKNOWN */
  status: string
  createdAt: string | null
  currency: string
  totalMinor: number | null
  buyer: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; address: MarketplaceAddress | null }
  delivery: { type: "APM" | "COURIER" | "UNKNOWN"; point: string | null; name: string | null; address: MarketplaceAddress | null; phone: string | null; priceMinor: number }
  invoice: { companyName: string | null; taxId: string | null; firstName: string | null; lastName: string | null; address: MarketplaceAddress | null } | null
  lines: MarketplaceOrderLine[]
  paymentType: string | null
  /** The marketplace collected the money (anything but cash on delivery). */
  paid: boolean
  comment: string | null
}

/** One offer as this plugin would send it (the SDK's `Offer`: product info, stock, gross price, GPSR). */
export interface OfferPayload {
  externalId: string
  sku: string | null
  title: string
  ean: string
  brand: string
  mpn: string | null
  grossPriceMinor: number
  currency: string
  quantity: number
  images: string[]
  manufacturer: { name: string; email: string | null; address: string | null; phone: string | null }
}

export interface OfferResult {
  externalId: string
  remoteId: string
  /** PENDING, REJECTED, PUBLISHED, CLOSED, SOLDOUT */
  remoteStatus: string
}

export interface MarketplaceClient {
  readonly mode: "demo" | "sandbox" | "live"
  /** False while the live client is pending: the callers say so instead of trying. */
  readonly available: boolean
  /** A call that proves the credentials work. */
  check(): Promise<{ ok: true }>
  /** Create or update offers. SDK: `POST /v1/organizations/{organizationId}/offers/batch`, `PATCH .../offers/{offerId}`. */
  upsertOffers(offers: OfferPayload[]): Promise<OfferResult[]>
  /** Take an offer off the marketplace. SDK: `POST .../offers/{offerId}/close`. */
  closeOffer(remoteId: string): Promise<void>
  /** New orders since the cursor. SDK: `GET .../orders` and `GET .../orders/events`. */
  listNewOrders(cursor: string | null): Promise<{ orders: MarketplaceOrder[]; cursor: string | null }>
  /** One order, fresh (a retry of a held import reads it again). SDK: `GET .../orders/{orderId}`. Null when the marketplace does not know it. */
  getOrder(orderId: string): Promise<MarketplaceOrder | null>
  /** Accept an order after it was imported. SDK: `POST .../orders/{orderId}/accept`. */
  acceptOrder(orderId: string): Promise<void>
  /** Pass the tracking numbers of the shipment. The SDK says shipment information is passed on the order; the exact operation is to be read on the portal. */
  sendTracking(orderId: string, trackingNumbers: string[]): Promise<void>
}

export const API_PENDING_MESSAGE =
  "The InPost Von Halsky seller API is not connected in this version: it waits for the integrator agreement and the official API documentation. Nothing was sent. Demo mode shows every step on your catalog meanwhile."

/** What every method of the pending live client throws. */
export class MarketplaceApiPendingError extends Error {
  readonly code = "api_pending"
  readonly status = 501
  constructor(operation: string) {
    super(`${API_PENDING_MESSAGE} (${operation})`)
    this.name = "MarketplaceApiPendingError"
  }
}

export function isPending(err: unknown): boolean {
  return Boolean(err) && (err as { name?: unknown }).name === "MarketplaceApiPendingError"
}

/**
 * The live (and sandbox) client: PENDING. It keeps the credentials it would
 * use, never calls fetch, and every method refuses politely.
 */
export function createLiveClient(config: { mode: "sandbox" | "live"; apiUrl: string; organizationId: string; accessToken: string }): MarketplaceClient {
  const refuse = (operation: string) => Promise.reject(new MarketplaceApiPendingError(operation))
  void config
  return {
    mode: config.mode,
    available: false,
    check: () => refuse("check"),
    upsertOffers: () => refuse("upsertOffers"),
    closeOffer: () => refuse("closeOffer"),
    listNewOrders: () => refuse("listNewOrders"),
    getOrder: () => refuse("getOrder"),
    acceptOrder: () => refuse("acceptOrder"),
    sendTracking: () => refuse("sendTracking"),
  }
}

/** Tokens and bearer values out of a message before it is logged or stored. */
export function maskSecrets(message: string, secrets: readonly string[]): string {
  let out = message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***").replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "***")
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***")
  return out.slice(0, 800)
}
