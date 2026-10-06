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
export type OlxWriterKey = "lifecycle" | "price" | "publish"
export type OlxAlertKind = "live_sold_out" | "live_unpublished" | "stock_not_live" | "stock_not_listed"
export type OlxWriterBlocker = "config_off" | "not_armed" | "not_connected" | "no_write_scope"
export type OlxPlanState = "idle" | "pending" | "held" | "applying" | "done" | "failed" | "quarantined" | "unknown"
export type OlxPublicationState = "planned" | "blocked" | "publishing" | "published" | "failed" | "quarantined" | "unknown"

export interface OlxLocalizedText {
  en?: string
  pl?: string
}

export interface OlxReferenceDto {
  name: string
  url: string
  /** The store's icon: a data URI or an https URL. */
  icon: string | null
  description: OlxLocalizedText | null
  since: string | null
  metrics: Array<{ label: OlxLocalizedText; value: string }>
  links: Array<{ label: OlxLocalizedText; url: string }>
  /** The store's rating of the work and where it was given, e.g. Clutch. */
  review: {
    rating: number
    scale: number
    source: string
    url: string | null
    icon: string | null
    quote: OlxLocalizedText | null
    author: string | null
  } | null
}

export interface OlxProblemDto {
  code: string
  detail?: string
}

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

export interface OlxWriterRunItemDto {
  action: string
  olxId: string | null
  variantId: string | null
  outcome: string
  detail: string | null
}

export interface OlxWriterRunDto {
  id: string
  writer: OlxWriterKey
  mode: "dry_run" | "apply"
  trigger: "schedule" | "manual" | "auto"
  status: "ok" | "partial" | "error" | "skipped" | "held"
  planned: number
  attempted: number
  succeeded: number
  failed: number
  quarantined: number
  unknown: number
  skipped: number
  message: string | null
  items: OlxWriterRunItemDto[]
  actor: string | null
  durationMs: number
  startedAt: string
  finishedAt: string | null
  demo: boolean
}

export interface OlxPlanCountsDto {
  pending: number
  held: number
  failed: number
  quarantined: number
  unknown: number
  applying: number
  done: number
}

export interface OlxWriterDto {
  writer: OlxWriterKey
  /** The hard switch (plugin option). */
  allowedByConfig: boolean
  /** The runtime toggle in the admin. */
  armed: boolean
  /** Both switches on, and in live mode a token with the `write` scope. */
  active: boolean
  blockers: OlxWriterBlocker[]
  changedBy: string | null
  changedAt: string | null
  cap: number
  counts: OlxPlanCountsDto
  running: boolean
  lastRun: OlxWriterRunDto | null
  lastDryRun: OlxWriterRunDto | null
}

export interface OlxPlanSummaryDto {
  plannedAt: string | null
  /** The advert snapshot the plan used came from a complete read. */
  readComplete: boolean
  /** The Medusa stock read succeeded. */
  stockComplete: boolean
  /** Why the lifecycle plan is empty on purpose (incomplete_read, no_stock_data). */
  lifecycleSkipped: string | null
  guard: { held: boolean; endings: number; liveLinked: number; limit: number }
  price: { noPrice: number; otherCurrency: number; skipped: string | null }
  publish: {
    mapped: boolean
    candidates: number
    ready: number
    blocked: number
    /** Why publishing cannot be planned at all (not connected, no category mapping). */
    reason: string | null
  }
  message: string | null
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
  /** No writer acts right now. */
  readOnly: boolean
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
  /** The scope the consent asks for and whether the granted token can write. */
  scope: { requested: string; writeGranted: boolean }
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
  /** Live mode: the last complete read from the OLX API. */
  lastCompleteSyncAt: string | null
  running: boolean
  references: OlxReferenceDto[]
  alerts: Record<OlxAlertKind, number>
  stats: {
    enabled: boolean
    views: number
    phoneViews: number
    observers: number
    withStats: number
    oldestAt: string | null
    lastRunAt: string | null
    lastRunMessage: string | null
    running: boolean
  }
  messages: {
    enabled: boolean
    threads: number
    unreadThreads: number
    unreadMessages: number
    lastReadAt: string | null
    complete: boolean | null
    lastReadMessage: string | null
    running: boolean
    chatUrl: string
  }
  writers: OlxWriterDto[]
  plan: OlxPlanSummaryDto
  /** OLX blocked this server's IP after too many requests: jobs wait until then. */
  ipBlockedUntil: string | null
  /** Option values the admin explains (no secrets). */
  settings: {
    currency: string
    maxPriceChangePercent: number
    salesChannelId: string | null
    statsPerRun: number
    writersAllowed: Record<OlxWriterKey, boolean>
  }
  /** Demo mode: what the simulation changes, so the admin can say it. */
  simulation: { soldOut: string[]; unpublished: string[]; paused: string[]; missingAttribute: string | null } | null
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
  categoryId: number | null
  stats: { views: number | null; phoneViews: number | null; observers: number | null; at: string } | null
  /** Filled by the list routes: the alert this advert raises, and its unread messages. */
  alert: OlxAlertKind | null
  unread: number
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

export interface OlxAlertDto {
  id: string
  kind: OlxAlertKind
  variantId: string
  productId: string
  sku: string | null
  productTitle: string | null
  olxId: string | null
  advertTitle: string | null
  advertUrl: string | null
  advertStatus: string | null
  stock: number | null
  productStatus: string | null
  firstSeenAt: string | null
  demo: boolean
}

export interface OlxAlertsResponse {
  alerts: OlxAlertDto[]
  count: number
  limit: number
  offset: number
}

export interface OlxPlanItemDto {
  id: string
  writer: "lifecycle" | "price"
  olxId: string
  action: string
  reason: string | null
  from: unknown
  to: unknown
  state: OlxPlanState
  attempts: number
  lastError: string | null
  note: string | null
  plannedAt: string | null
  lastAttemptAt: string | null
  doneAt: string | null
  pausedAt: string | null
  title: string | null
  variantId: string | null
  productId: string | null
  sku: string | null
  demo: boolean
}

export interface OlxPlanResponse {
  items: OlxPlanItemDto[]
  count: number
  limit: number
  offset: number
}

export interface OlxPublicationDto {
  id: string
  variantId: string
  productId: string
  sku: string
  title: string
  olxCategoryId: number | null
  state: OlxPublicationState
  missing: OlxProblemDto[]
  warnings: OlxProblemDto[]
  payload: Record<string, unknown> | null
  attempts: number
  lastError: string | null
  note: string | null
  plannedAt: string | null
  olxId: string | null
  olxUrl: string | null
  olxStatus: string | null
  adopted: boolean
  publishedAt: string | null
  demo: boolean
}

export interface OlxPublicationsResponse {
  publications: OlxPublicationDto[]
  count: number
  limit: number
  offset: number
}

export interface OlxWriterRunsResponse {
  runs: OlxWriterRunDto[]
}

export interface OlxThreadDto {
  id: string
  key: string
  advertOlxId: string | null
  advertTitle: string | null
  advertUrl: string | null
  productId: string | null
  productTitle: string | null
  sku: string | null
  unread: number
  total: number
  createdAt: string | null
  favourite: boolean
  demo: boolean
}

export interface OlxThreadsResponse {
  threads: OlxThreadDto[]
  count: number
  limit: number
  offset: number
  chatUrl: string
}

export interface OlxProductAdvertsResponse {
  mode: OlxMode
  adverts: OlxAdvertDto[]
  alerts: OlxAlertDto[]
  publications: OlxPublicationDto[]
  unread: number
  chatUrl: string
}

export interface OlxSyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: OlxMode
}

export interface OlxWriterRunResponse {
  started: boolean
  alreadyRunning: boolean
  /** A dry run answers with its result right away. */
  run: OlxWriterRunDto | null
}

/** Storefront: live adverts of a product, for an "Also on OLX" link. */
export interface OlxStoreProductAdvertsResponse {
  adverts: Array<{ url: string; title: string; price: { value: number; currency: string } | null; sku: string | null }>
}
