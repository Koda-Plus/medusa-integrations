/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Zero imports: the admin
 * bundle imports these types, Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. Tokens and the device code stay in
 * the module; the admin gets dates, flags and the code a PERSON types at
 * allegro.pl, which is useless without our client secret.
 */

export type AllegroMode = "demo" | "live"
export type AllegroStatusGroup = "live" | "activating" | "draft" | "ended"
export type AllegroStockState =
  | "oversell"
  | "sold_out"
  | "under_listed"
  | "ended_in_stock"
  | "ok"
  | "untracked"
  | "unknown"
export type AllegroOfferFilter = "all" | "linked" | "unmatched" | "stock" | "ended_in_stock" | "ended" | "drafts" | "nokey"
export type AllegroOrderFilter = "all" | "open" | "sent" | "cancelled" | "unmatched"
export type AllegroRunKind = "offers" | "orders"

export interface AllegroMoneyDto {
  value: number
  currency: string
}

export interface AllegroRunDto {
  id: string
  kind: AllegroRunKind
  source: "api" | "demo"
  trigger: "schedule" | "manual" | "auto"
  status: "ok" | "partial" | "error"
  complete: boolean
  pages: number
  items: number
  statuses: Record<string, number>
  linked: number
  linkedLive: number
  unmatchedLive: number
  issues: number
  created: number
  updated: number
  removed: number
  message: string | null
  durationMs: number
  startedAt: string
  finishedAt: string | null
}

export interface AllegroStatusResponse {
  mode: AllegroMode
  /** Live mode only: all options present and valid. Always true in demo mode. */
  configured: boolean
  /** Option names still missing in live mode. */
  missing: string[]
  environment: "production" | "sandbox"
  webHost: string
  clientIdPrefix: string | null
  readOnly: true
  scopes: string
  schedules: { offers: string; orders: string }
  syncEnabled: boolean
  ordersEnabled: boolean
  connection: {
    connected: boolean
    connectedAt: string | null
    disconnectedAt: string | null
    refreshedAt: string | null
    accessExpiresAt: string | null
    scope: string | null
    lastError: string | null
    lastErrorAt: string | null
  }
  /** A device login waiting for the seller to type the code at allegro.pl. */
  connecting: { userCode: string; url: string; expiresAt: string; intervalS: number } | null
  counts: {
    offers: number
    live: number
    drafts: number
    ended: number
    linked: number
    linkedLive: number
    unmatchedLive: number
    noKey: number
    products: number
    stockIssues: number
    underListed: number
    endedInStock: number
    orders: number
    ordersOpen: number
    ordersUnmatched: number
  }
  lastRuns: { offers: AllegroRunDto | null; orders: AllegroRunDto | null }
  running: { offers: boolean; orders: boolean }
}

export interface AllegroOfferDto {
  id: string
  allegroId: string
  name: string
  url: string
  status: string
  statusGroup: AllegroStatusGroup
  price: AllegroMoneyDto | null
  available: number | null
  sold: number | null
  medusaAvailable: number | null
  stockState: AllegroStockState | null
  externalId: string | null
  matchKey: string | null
  variantId: string | null
  productId: string | null
  sku: string | null
  productTitle: string | null
  isPrimary: boolean
  demo: boolean
  format: string | null
  startedAt: string | null
  updatedAt: string | null
}

export interface AllegroOffersResponse {
  offers: AllegroOfferDto[]
  count: number
  limit: number
  offset: number
}

export interface AllegroOrderLineDto {
  offerId: string
  offerName: string
  offerUrl: string
  externalId: string | null
  quantity: number
  price: AllegroMoneyDto | null
  variantId: string | null
  productId: string | null
  sku: string | null
  productTitle: string | null
}

export interface AllegroOrderDto {
  id: string
  allegroId: string
  status: string
  fulfillmentStatus: string | null
  group: "open" | "sent" | "cancelled"
  total: AllegroMoneyDto | null
  boughtAt: string | null
  updatedAt: string | null
  deliveryMethod: string | null
  lines: AllegroOrderLineDto[]
  unmatchedLines: number
  demo: boolean
}

export interface AllegroOrdersResponse {
  orders: AllegroOrderDto[]
  count: number
  limit: number
  offset: number
}

export interface AllegroRunsResponse {
  runs: AllegroRunDto[]
}

export interface AllegroProductOffersResponse {
  mode: AllegroMode
  offers: AllegroOfferDto[]
}

export interface AllegroSyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: AllegroMode
}

/** One step of the device login, as the admin polls it. */
export interface AllegroConnectPollResponse {
  state: "pending" | "connected" | "denied" | "expired" | "none"
  intervalS: number | null
}

/** Storefront: live offers of a product, for an "Also on Allegro" link. */
export interface AllegroStoreProductOffersResponse {
  offers: Array<{ url: string; name: string; price: AllegroMoneyDto | null; sku: string | null }>
}
