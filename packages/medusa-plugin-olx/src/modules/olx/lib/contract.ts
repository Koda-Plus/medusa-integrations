/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Zero imports: the admin
 * bundle imports these types, Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. Tokens stay in the module; the admin
 * gets dates, flags and the consent URL it sends the seller to.
 */

export type OlxMode = "demo" | "live"
export type OlxStatusGroup = "live" | "limited" | "ended"
export type OlxAdvertFilter = "all" | "linked" | "unmatched" | "limited" | "ended" | "nokey"

export interface OlxRunDto {
  id: string
  source: "api" | "demo"
  trigger: "schedule" | "manual" | "auto"
  status: "ok" | "partial" | "error"
  complete: boolean
  pages: number
  adverts: number
  statuses: Record<string, number>
  linked: number
  linkedLive: number
  unmatchedLive: number
  created: number
  updated: number
  removed: number
  message: string | null
  durationMs: number
  startedAt: string
  finishedAt: string | null
}

export interface OlxStatusResponse {
  mode: OlxMode
  /** Live mode only: all options present and valid. Always true in demo mode. */
  configured: boolean
  /** Option names still missing in live mode. */
  missing: string[]
  market: string
  marketHost: string
  redirectUri: string | null
  clientIdPrefix: string | null
  readOnly: true
  schedule: string
  syncEnabled: boolean
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
  /** A connection attempt waiting for the seller's consent. */
  connecting: { url: string; expiresAt: string } | null
  counts: {
    adverts: number
    live: number
    limited: number
    ended: number
    linked: number
    linkedLive: number
    unmatchedLive: number
    noKey: number
    products: number
  }
  lastRun: OlxRunDto | null
  running: boolean
}

export interface OlxAdvertDto {
  id: string
  olxId: string
  title: string
  url: string
  status: string
  statusGroup: OlxStatusGroup
  price: { value: number; currency: string } | null
  externalId: string | null
  descriptionSku: string | null
  matchKey: string | null
  matchSource: "external_id" | "description" | null
  variantId: string | null
  productId: string | null
  sku: string | null
  productTitle: string | null
  isPrimary: boolean
  demo: boolean
  validTo: string | null
  olxCreatedAt: string | null
  updatedAt: string | null
}

export interface OlxAdvertsResponse {
  adverts: OlxAdvertDto[]
  count: number
  limit: number
  offset: number
}

export interface OlxRunsResponse {
  runs: OlxRunDto[]
}

export interface OlxProductAdvertsResponse {
  mode: OlxMode
  adverts: OlxAdvertDto[]
}

export interface OlxSyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: OlxMode
}

/** Storefront: live adverts of a product, for an "Also on OLX" link. */
export interface OlxStoreProductAdvertsResponse {
  adverts: Array<{ url: string; title: string; price: { value: number; currency: string } | null; sku: string | null }>
}
