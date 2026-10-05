/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Types only, zero imports: the
 * admin bundle imports them and Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. The token stays on the server; the
 * admin learns only whether it is set.
 */

export type BaseLinkerMode = "demo" | "live"
export type StockSyncMode = "off" | "plan" | "write"
export type RunKind = "catalog" | "stock" | "orders" | "statuses"
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
  schedules: { catalog: string; orders: string; statuses: string }
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
}

export interface ProductCardsResponse {
  mode: BaseLinkerMode
  cards: CardDto[]
}

export interface RunsResponse {
  runs: RunDto[]
}

export interface SyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: BaseLinkerMode
  what: "catalog" | "statuses" | "orders"
}

export interface CheckResponse {
  result: CheckResult
  status: StatusResponse
}

export interface SendResponse {
  order: OrderDto
}
