/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Zero imports: the admin
 * bundle imports these types, Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. Tokens and the device code stay in
 * the module; the admin gets dates, flags and the code a PERSON types at
 * allegro.pl, which is useless without our client secret. No type carries a
 * buyer's name, address, e-mail or phone either.
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
export type AllegroOrderFilter = "all" | "open" | "sent" | "cancelled" | "unmatched" | "imported" | "held"
export type AllegroRunKind = "offers" | "orders" | "stock" | "prices" | "import" | "shipping" | "invoices" | "issues" | "publish"
export type AllegroWriterKey = "stock" | "orders" | "shipping" | "invoices" | "prices" | "publish"
export type AllegroWriterBlocker = "hard_switch" | "not_configured" | "not_connected" | "missing_scope"
export type AllegroPlanKind = "stock" | "prices" | "publish"
export type AllegroPlanStatus = "planned" | "skipped" | "in_sync" | "quarantined" | "deferred" | "applied" | "failed" | "unknown"
export type AllegroImportStatus = "pending" | "importing" | "imported" | "held" | "skipped" | "cancelled" | "unknown"
export type AllegroImportFilter = "all" | "imported" | "held" | "pending" | "skipped" | "attention" | "cancelled"
export type AllegroOutboxStatus = "pending" | "sending" | "done" | "failed" | "unknown" | "skipped"
export type AllegroIssueKind = "return" | "dispute" | "claim"
export type AllegroIssueFilter = "all" | "open" | "needs_reply" | "returns" | "disputes" | "claims"

export interface AllegroMoneyDto {
  value: number
  currency: string
}

export interface AllegroRunDto {
  id: string
  kind: AllegroRunKind
  source: "api" | "demo"
  trigger: "schedule" | "manual" | "auto" | "event"
  status: "ok" | "partial" | "error" | "skipped"
  complete: boolean
  dryRun: boolean
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

export interface AllegroWriterDto {
  key: AllegroWriterKey
  /** The hard switch: `writes.<key>` in the plugin options. */
  allowed: boolean
  /** The runtime toggle as a person left it (in the current mode). */
  armed: boolean
  /** Both switches on and nothing blocking. */
  effective: boolean
  blockers: AllegroWriterBlocker[]
  missingScopes: string[]
  /** Armed in the other mode (demo or live), so it counts as off now. */
  modeChanged: boolean
  writesAllegro: boolean
  changedBy: string | null
  changedAt: string | null
  failureStreak: number
  lastFailure: string | null
  lastFailureAt: string | null
  trippedAt: string | null
  tripReason: string | null
  lastRunAt: string | null
  lastSuccessAt: string | null
}

export interface AllegroLocalizedText {
  en: string | null
  pl: string | null
}

export interface AllegroReferenceDto {
  name: string
  url: string
  description: AllegroLocalizedText | null
  since: string | null
  metrics: Array<{ label: AllegroLocalizedText; value: string }>
  links: Array<{ label: AllegroLocalizedText; url: string }>
}

export interface AllegroPlanSummaryDto {
  kind: AllegroPlanKind
  plannedAt: string | null
  refused: string | null
  /** Items per status: planned, deferred, quarantined, skipped, in_sync, applied, failed. */
  counts: Record<string, number>
  lastApply: { at: string | null; applied: number; failed: number; message: string | null } | null
}

export interface AllegroStatusResponse {
  mode: AllegroMode
  version: string
  /** Live mode only: all options present and valid. Always true in demo mode. */
  configured: boolean
  /** Option names still missing in live mode. */
  missing: string[]
  environment: "production" | "sandbox"
  webHost: string
  appsUrl: string
  clientIdPrefix: string | null
  userAgent: string
  appName: string | null
  /** True when no writer is effective. */
  readOnly: boolean
  /** Scopes the device login asks for, from the options. */
  scopes: string
  /** Scopes of the stored token, null when not connected (or in demo mode). */
  grantedScopes: string[] | null
  /** Scopes the options need that the stored token lacks: connect again. */
  missingScopes: string[]
  schedules: Record<AllegroRunKind, string>
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
  writers: AllegroWriterDto[]
  settings: {
    stockPush: "decrease" | "mirror"
    stockPushCap: number
    endOffersAtZero: boolean
    breakerThreshold: number
    importPerRun: number
    invoiceKinds: string[]
    issues: { returns: boolean; disputes: boolean; messages: boolean }
    prices: { priceListId: string | null; minKey: string; maxKey: string; requireFloor: boolean; maxChangePercent: number; cap: number }
    publish: { ready: boolean; missing: string[]; cap: number }
    importTarget: {
      salesChannelId: string | null
      salesChannelName: string | null
      regionId: string | null
      regionName: string | null
      shippingOptionId: string | null
      warnings: string[]
    }
    fakturownia: boolean
  }
  references: AllegroReferenceDto[]
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
  plans: Record<AllegroPlanKind, AllegroPlanSummaryDto>
  imports: {
    pending: number
    held: number
    imported: number
    skipped: number
    cancelled: number
    attention: number
    mismatch: number
    cursor: { id: string; at: string | null } | null
    lastOkAt: string | null
  }
  outbox: {
    shipping: { pending: number; failed: number; done: number }
    invoices: { pending: number; failed: number; done: number }
  }
  issues: {
    returnsOpen: number
    disputesOpen: number
    claimsOpen: number
    needReply: number
    dueSoon: number
    unreadThreads: number | null
    threadsScanned: number
    checkedAt: string | null
  }
  panel: { orders: string; returns: string; discussions: string; messages: string }
  lastRuns: Partial<Record<AllegroRunKind, AllegroRunDto | null>>
  running: Record<AllegroRunKind, boolean>
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
  /** The import of this checkout form into Medusa, when there is one. */
  import: { id: string; status: AllegroImportStatus; orderId: string | null; displayId: number | null; reasonCode: string | null; reason: string | null } | null
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

export interface AllegroWriterToggleResponse {
  writer: AllegroWriterDto
}

export interface AllegroPlanItemDto {
  id: string
  kind: AllegroPlanKind
  targetKey: string
  allegroId: string | null
  url: string | null
  variantId: string | null
  productId: string | null
  sku: string | null
  title: string
  action: string
  reason: string
  status: AllegroPlanStatus
  /** Stock: `{ quantity }`; prices: `{ amount, currency }`; publish: `{ ean, catalogProductId, catalogName }`. */
  current: Record<string, unknown> | null
  target: Record<string, unknown> | null
  failures: number
  lastError: string | null
  plannedAt: string | null
  appliedAt: string | null
  demo: boolean
}

export interface AllegroPlanResponse {
  kind: AllegroPlanKind
  summary: AllegroPlanSummaryDto
  items: AllegroPlanItemDto[]
  count: number
  limit: number
  offset: number
}

export interface AllegroPlanRunResponse {
  kind: AllegroPlanKind
  dryRun: boolean
  summary: AllegroPlanSummaryDto
  applied: number
  failed: number
  message: string | null
}

export interface AllegroImportDto {
  id: string
  checkoutFormId: string
  status: AllegroImportStatus
  reasonCode: string | null
  reason: string | null
  orderId: string | null
  displayId: number | null
  allegroStatus: string | null
  fulfillmentStatus: string | null
  paymentType: string | null
  paid: boolean
  total: AllegroMoneyDto | null
  medusaTotal: AllegroMoneyDto | null
  totalMismatch: boolean
  lineCount: number
  boughtAt: string | null
  importedAt: string | null
  attention: string | null
  source: string
  attempts: number
  demo: boolean
  updatedAt: string | null
}

export interface AllegroImportsResponse {
  imports: AllegroImportDto[]
  count: number
  limit: number
  offset: number
}

export interface AllegroImportRunResponse {
  started: boolean
  alreadyRunning: boolean
  dryRun: boolean
  /** Dry run only: what the next run would do with the waiting forms. */
  preview: Array<{ checkoutFormId: string; decision: "create" | "hold" | "skip" | "wait" | "duplicate"; reason: string | null; lines: number }>
  message: string | null
}

export interface AllegroImportWindowResponse {
  queued: number
  known: number
  read: number
  complete: boolean
  message: string | null
}

export interface AllegroOutboxDto {
  id: string
  writer: "shipping" | "invoices"
  kind: "parcel" | "status" | "invoice"
  checkoutFormId: string
  orderId: string | null
  status: AllegroOutboxStatus
  attempts: number
  lastError: string | null
  /** A waybill and its carrier, a status, or an invoice number: never personal data. */
  summary: string
  doneAt: string | null
  createdAt: string | null
  demo: boolean
}

export interface AllegroOutboxResponse {
  items: AllegroOutboxDto[]
  count: number
  limit: number
  offset: number
}

export interface AllegroIssueDto {
  id: string
  kind: AllegroIssueKind
  allegroId: string
  checkoutFormId: string | null
  orderId: string | null
  displayId: number | null
  status: string
  reasonCode: string | null
  referenceNumber: string | null
  openedAt: string | null
  dueAt: string | null
  needsReply: boolean
  open: boolean
  items: number
  demo: boolean
  link: string
}

export interface AllegroIssuesResponse {
  issues: AllegroIssueDto[]
  count: number
  limit: number
  offset: number
}

/** POST answers that only say what happened. */
export interface AllegroActionResponse {
  ok: boolean
  message: string | null
}
