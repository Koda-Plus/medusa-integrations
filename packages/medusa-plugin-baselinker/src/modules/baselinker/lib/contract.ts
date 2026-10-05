/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Types only, zero imports: the
 * admin bundle imports them and Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. The token stays on the server; the
 * admin learns only whether it is set.
 */

export type BaseLinkerMode = "demo" | "live"
export type StockSyncMode = "off" | "plan" | "write"
export type RunKind =
  | "catalog"
  | "stock"
  | "orders"
  | "statuses"
  | "catalog_import"
  | "cards"
  | "stock_push"
  | "prices"
  | "imports"
  | "returns"
  | "invoices"

export const RUN_KINDS: readonly RunKind[] = [
  "catalog",
  "stock",
  "orders",
  "statuses",
  "catalog_import",
  "cards",
  "stock_push",
  "prices",
  "imports",
  "returns",
  "invoices",
]
export type RunSource = "api" | "demo"
export type RunTrigger = "schedule" | "manual" | "auto"
export type RunStatus = "ok" | "partial" | "error"
export type CardFilter = "all" | "linked" | "unmatched" | "conflicts" | "nosku"
export type CardConflict = "duplicate_sku" | "duplicate_ean" | "ambiguous_variant"
export type OrderRowStatus = "pending" | "sent" | "failed" | "skipped"
export type OrderFilter = "all" | OrderRowStatus
export type StockChangeStatus = "planned" | "applied" | "over_cap" | "failed"

export interface RunDto {
  id: string
  kind: RunKind
  source: RunSource
  trigger: RunTrigger
  status: RunStatus
  complete: boolean
  counts: Record<string, unknown>
  message: string | null
  durationMs: number
  startedAt: string
  finishedAt: string | null
}

export interface CardDto {
  id: string
  blProductId: string
  parentId: string | null
  sku: string | null
  ean: string | null
  name: string
  stock: number | null
  price: Record<string, number> | null
  matchKey: string | null
  matchSource: "sku" | "ean" | null
  variantId: string | null
  productId: string | null
  variantSku: string | null
  productTitle: string | null
  conflict: CardConflict | null
  demo: boolean
  updatedAt: string | null
  /** 0.2: a main card with variants (a container): stored, never linked. */
  isContainer: boolean
}

export interface StockChangeDto {
  id: string
  variantId: string
  productId: string | null
  sku: string | null
  productTitle: string | null
  blProductId: string
  inventoryItemId: string
  locationId: string
  levelId: string | null
  medusaStocked: number | null
  medusaReserved: number
  blStock: number
  target: number
  delta: number
  kind: "update" | "create"
  status: StockChangeStatus
  afterStocked: number | null
  appliedAt: string | null
  createdAt: string | null
}

export interface OrderDto {
  id: string
  orderId: string
  displayId: number | null
  status: OrderRowStatus
  blOrderId: string | null
  attempts: number
  nextAttemptAt: string | null
  lastError: string | null
  lastErrorCode: string | null
  sentAt: string | null
  blStatusId: number | null
  blStatusName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  carrier: string | null
  statusCheckedAt: string | null
  fulfilledAt: string | null
  demo: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface CheckResult {
  ok: boolean
  mode: BaseLinkerMode
  error: string | null
  checkedAt: string
  inventories: Array<{ id: number; name: string; warehouses: string[]; defaultWarehouse: string | null }>
  /** Whether `inventoryId` exists on the account; null when the option is not set. */
  inventoryFound: boolean | null
  inventoryName: string | null
  /** Whether `warehouseId` belongs to that catalog; null when it cannot be told. */
  warehouseFound: boolean | null
  /** Warehouses of the configured catalog, to pick `warehouseId` from. */
  warehouses: string[]
  /** 0.2: price groups of the account (`getInventoryPriceGroups`). */
  priceGroups?: Array<{ id: number; name: string; currency: string; derived: boolean; isDefault: boolean }>
  /** 0.2: warehouses with their type and whether stock may be written (`getInventoryWarehouses`). */
  warehouseDetails?: Array<{ key: string; name: string; type: string; editable: boolean }>
  /** 0.2: order sources (`getOrderSources`), to pick `orderImportSources` and `customSourceId` from. */
  orderSources?: Array<{ type: string; id: number; name: string }>
  /** 0.2: order statuses (`getOrderStatusList`). */
  statuses?: Array<{ id: number; name: string }>
  /** 0.2: custom order fields (`getOrderExtraFields`), for `invoiceNumberField`. */
  extraFields?: Array<{ id: number; name: string; type: string }>
  /** 0.2: what one journal call answered: events, an empty answer, or an error. */
  journal?: "events" | "empty" | "error" | null
}

export interface StatusResponse {
  mode: BaseLinkerMode
  /** Live mode: every option the enabled features need is present. Always true in demo mode. */
  configured: boolean
  missing: string[]
  tokenSet: boolean
  options: {
    inventoryId: number | null
    warehouseId: string | null
    orderStatusId: number | null
    customSourceId: number | null
    stockLocationId: string | null
    stockSync: StockSyncMode
    maxStockChangesPerRun: number
    exportOrders: boolean
    fulfillOnStatusIds: number[]
    closedStatusIds: number[]
    codProviders: string[]
    skipOrderMetadataKey: string
    catalogSyncEnabled: boolean
    requestsPerMinute: number
  }
  /** Which parts can run with the current options. */
  features: { catalog: boolean; stock: boolean; orders: boolean; statuses: boolean }
  counts: {
    cards: number
    linked: number
    unmatched: number
    conflicts: number
    noSku: number
    onlyInMedusa: number
    stockChanges: number
    unitsAdded: number
    unitsRemoved: number
    ordersPending: number
    ordersSent: number
    ordersFailed: number
    ordersSkipped: number
    ordersSent24h: number
  }
  lastRuns: Partial<Record<RunKind, RunDto>>
  lastCheck: CheckResult | null
  running: string[]
  schedules: { catalog: string; orders: string; statuses: string; imports: string; returns: string }
  /* ---- 0.2 ---- */
  directions: DirectionsDto
  writers: WriterDto[]
  references: ReferenceDto[]
  journal: JournalDto
  more: {
    catalogSource: "medusa" | "baselinker"
    stockSource: "baselinker" | "medusa"
    priceGroupId: number | null
    priceCurrency: string
    maxCatalogChangesPerRun: number
    maxPriceChangesPerRun: number
    quarantineAfter: number
    catalogImportStatus: "published" | "draft"
    createMissingCategories: boolean
    manufacturerAs: "metadata" | "tag"
    draftRemovedProducts: boolean
    weightUnit: "g" | "kg"
    orderImportSources: string[]
    orderImportSalesChannelId: string | null
    orderImportRegionId: string | null
    orderImportShippingOptionId: string | null
    orderImportCancelStatusIds: number[]
    orderImportMaxAgeHours: number
    exportMarketplaceOrders: boolean
    returnsSync: boolean
    returnsWindowDays: number
    invoiceNumberField: string
    invoiceNumberKinds: string[]
    writersOff: string[]
  }
  features2: { catalogImport: boolean; cards: boolean; stockPush: boolean; prices: boolean; orderImport: boolean; returns: boolean; invoiceNumbers: boolean }
  counts2: {
    plans: Record<PlanKind, PlanSummary>
    imports: { pending: number; imported: number; skipped: number; failed: number; flagged: number; imported24h: number }
    returns: number
    invoices: { pending: number; written: number; conflict: number; failed: number; skipped: number }
    quarantined: number
  }
}

/* ------------------------------------------------------------------ */
/* 0.2: directions and writers                                         */
/* ------------------------------------------------------------------ */

export type WriterKey = "catalogImport" | "cards" | "stockToMedusa" | "stockToBaseLinker" | "prices" | "orderImport" | "invoiceNumbers"
export type WriterBlock = "inactive_direction" | "hard_off" | "stock_not_write" | "not_configured" | "not_armed"

export interface WriterDto {
  key: WriterKey
  active: boolean
  allowed: boolean
  hardSwitch: "hard_off" | "stock_not_write" | null
  configured: boolean
  armed: boolean
  armedBy: "admin" | "options" | null
  live: boolean
  blocked: WriterBlock | null
  changedBy: string | null
  changedByLabel: string | null
  changedAt: string | null
}

export interface DirectionsDto {
  catalog: "medusa" | "baselinker"
  stock: "baselinker" | "medusa"
  /** Demo mode: the directions can be switched in the admin to look at both. */
  switchable: boolean
}

export interface ArmResponse {
  writer: WriterDto
  status: StatusResponse
}

export interface JournalDto {
  mode: "auto" | "off"
  /** active: events arrive; empty: answers are empty (maybe not enabled); off: not used; demo: simulated. */
  state: "active" | "empty" | "off" | "demo" | "unknown"
  lastLogId: number | null
  lastEventAt: string | null
  lastReadAt: string | null
}

export interface LocalizedDto {
  en?: string
  pl?: string
}

export interface ReferenceDto {
  name: string
  url: string
  description: LocalizedDto | null
  since: string | null
  metrics: Array<{ label: LocalizedDto; value: string }>
  links: Array<{ label: LocalizedDto; url: string }>
}

/* ------------------------------------------------------------------ */
/* 0.2: plans                                                          */
/* ------------------------------------------------------------------ */

export type PlanKind = "catalog_import" | "cards" | "stock_push" | "prices"
export const PLAN_KINDS: readonly PlanKind[] = ["catalog_import", "cards", "stock_push", "prices"]
export type PlanAction = "create" | "update" | "draft" | "skip" | "conflict"
export type PlanStatus = "planned" | "applied" | "failed" | "over_cap" | "quarantined" | "info"
export type PlanFilter = "all" | "changes" | "create" | "update" | "draft" | "conflict" | "skip" | "failed" | "quarantined"

export interface PlanChange {
  field: string
  from: string | number | null
  to: string | number | null
}

export interface PlanItemDto {
  id: string
  kind: PlanKind
  itemKey: string
  action: PlanAction
  status: PlanStatus
  reason: string | null
  label: string | null
  sku: string | null
  productId: string | null
  variantId: string | null
  blProductId: string | null
  changes: PlanChange[]
  error: string | null
  appliedAt: string | null
  demo: boolean
  createdAt: string | null
  quarantine: { id: string; failures: number; quarantinedAt: string | null; lastError: string | null } | null
}

export interface PlanSummary {
  total: number
  create: number
  update: number
  draft: number
  skip: number
  conflict: number
  applied: number
  failed: number
  overCap: number
  quarantined: number
}

export interface PlansResponse {
  kind: PlanKind
  mode: BaseLinkerMode
  items: PlanItemDto[]
  count: number
  limit: number
  offset: number
  summary: PlanSummary
  run: RunDto | null
  writer: WriterDto | null
}

export interface ReleaseResponse {
  released: boolean
}

/* ------------------------------------------------------------------ */
/* 0.2: imported orders, returns, invoice numbers                      */
/* ------------------------------------------------------------------ */

export type ImportStatus = "pending" | "imported" | "skipped" | "failed"
export type ImportFilter = "all" | ImportStatus | "flagged"

export interface ImportDto {
  id: string
  blOrderId: string
  source: string
  sourceId: string | null
  externalOrderId: string | null
  marketplaceRef: string | null
  status: ImportStatus
  orderId: string | null
  displayId: number | null
  attempts: number
  nextAttemptAt: string | null
  lastError: string | null
  lastErrorCode: string | null
  confirmedAt: string | null
  total: number | null
  currency: string | null
  lines: number
  unlinkedLines: number
  paymentState: string | null
  blStatusId: number | null
  blStatusName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  carrier: string | null
  flag: string | null
  importedAt: string | null
  canceledAt: string | null
  fulfilledAt: string | null
  demo: boolean
  createdAt: string | null
}

export interface ImportsResponse {
  imports: ImportDto[]
  count: number
  limit: number
  offset: number
}

export interface ReturnProductDto {
  name: string
  sku: string | null
  quantity: number
  price: number | null
  reason: string | null
}

export interface ReturnDto {
  id: string
  blReturnId: string
  blOrderId: string | null
  orderId: string | null
  displayId: number | null
  source: string | null
  externalReturnId: string | null
  statusId: number | null
  statusName: string | null
  fulfillmentStatus: number | null
  refunded: number | null
  currency: string | null
  products: ReturnProductDto[]
  createdInBlAt: string | null
  statusChangedAt: string | null
  demo: boolean
}

export interface ReturnsResponse {
  returns: ReturnDto[]
  count: number
  limit: number
  offset: number
}

export type InvoiceRowStatus = "pending" | "written" | "conflict" | "skipped" | "failed"

export interface InvoiceDto {
  id: string
  documentId: string
  orderId: string
  displayId: number | null
  blOrderId: string | null
  kind: string
  number: string | null
  field: string
  status: InvoiceRowStatus
  attempts: number
  lastError: string | null
  lastErrorCode: string | null
  writtenAt: string | null
  demo: boolean
  createdAt: string | null
}

export interface InvoicesResponse {
  invoices: InvoiceDto[]
  count: number
  limit: number
  offset: number
}

export interface RetryResponse {
  ok: boolean
}

export interface CardsResponse {
  cards: CardDto[]
  count: number
  limit: number
  offset: number
}

export interface StockResponse {
  mode: BaseLinkerMode
  stockSync: StockSyncMode
  run: RunDto | null
  changes: StockChangeDto[]
  count: number
  limit: number
  offset: number
  summary: { changes: number; unitsAdded: number; unitsRemoved: number; applied: number; overCap: number }
}

export interface OrdersResponse {
  orders: OrderDto[]
  count: number
  limit: number
  offset: number
}

export interface OrderByMedusaResponse {
  mode: BaseLinkerMode
  exportOrders: boolean
  /** Export on and configured: the widget may offer "Send to BaseLinker now". */
  canSend: boolean
  skipKey: string
  order: OrderDto | null
  /** 0.2: the order came from BaseLinker (a marketplace order this plugin imported). */
  imported: ImportDto | null
  /** 0.2: `metadata.marketplace_order_ref` of the order, whichever plugin set it. */
  marketplaceRef: string | null
}

export interface ProductCardsResponse {
  mode: BaseLinkerMode
  cards: CardDto[]
}

export interface RunsResponse {
  runs: RunDto[]
}

export type SyncWhat = "catalog" | "statuses" | "orders" | "imports" | "returns" | "invoices"

export interface SyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: BaseLinkerMode
  what: SyncWhat
}

export interface CheckResponse {
  result: CheckResult
  status: StatusResponse
}

export interface SendResponse {
  order: OrderDto
}
