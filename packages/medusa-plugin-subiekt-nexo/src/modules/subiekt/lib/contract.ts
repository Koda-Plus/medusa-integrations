/**
 * TYPES OF THE BRIDGE CONTRACT, version 1 (`contract/openapi.yaml`).
 * Types only, no runtime code: files that import from here use `import type`,
 * which the unit tests' type stripping removes entirely.
 *
 * The second half describes what the admin receives from `/admin/subiekt/*`.
 */

/* ------------------------------------------------------------------ */
/* Bridge contract                                                     */
/* ------------------------------------------------------------------ */

export type BridgeMode = "sfera" | "fake"

export interface BridgeHealth {
  status: "ok" | "degraded"
  bridge: { name: string; version: string; contract: string; mode: BridgeMode }
  subiekt: {
    connected: boolean
    product?: string | null
    version?: string | null
    database?: string | null
    company?: string | null
    warehouse?: string | null
    checked_at?: string | null
    error?: string | null
  }
  time: string
}

export interface ContractAddress {
  first_name: string | null
  last_name: string | null
  company: string | null
  address_1: string | null
  address_2: string | null
  postal_code: string | null
  city: string | null
  province: string | null
  country_code: string | null
  phone: string | null
}

export interface ContractLine {
  line_id: string
  sku: string | null
  ean: string | null
  title: string | null
  product_title: string | null
  variant_title: string | null
  quantity: number
  unit_price_gross: number
  total_gross: number
  discount_gross: number
  tax_rate: number | null
}

export type PaymentStatus = "captured" | "authorized" | "awaiting" | "cash_on_delivery" | "not_required"

export interface ContractOrder {
  order_id: string
  display_id: number
  currency_code: string
  placed_at: string
  email: string | null
  customer: {
    id: string | null
    first_name: string | null
    last_name: string | null
    company_name: string | null
    phone: string | null
  } | null
  billing_address: ContractAddress | null
  shipping_address: ContractAddress | null
  invoice: { requested: boolean; tax_id: string | null; company_name: string | null }
  lines: ContractLine[]
  shipping: {
    name: string | null
    option_id: string | null
    price_gross: number
    tax_rate: number | null
    pickup_point: { id: string; name: string | null; address: string | null } | null
  } | null
  payment: {
    status: PaymentStatus
    provider_id: string | null
    method: string | null
    amount_paid: number
    captured_at: string | null
    due_days: number | null
  }
  totals: {
    items_gross: number
    shipping_gross: number
    discount_gross: number
    tax_total: number | null
    total_gross: number
  }
  note: string | null
  metadata: Record<string, unknown>
}

export interface ContractDocument {
  kind: string
  number: string
  id?: string | null
  issued_at: string
  status?: "open" | "canceled" | "completed"
  warehouse?: string | null
  related?: Array<{ kind: string; number: string }>
}

export interface OrderResult {
  order_id: string
  created: boolean
  document: ContractDocument
  warnings?: string[]
}

export interface OrderStatusResult {
  order_id: string
  documents: ContractDocument[]
}

export interface CancelResult {
  order_id: string
  status: "canceled" | "already_canceled" | "not_found"
  manual_action_required: boolean
  message?: string | null
  documents?: ContractDocument[]
}

export interface FulfillmentRequest {
  fulfillment_id: string
  items?: Array<{ line_id: string; quantity: number }>
  note?: string | null
}

export interface FulfillmentResult {
  order_id: string
  created: boolean
  document: ContractDocument
}

export interface StockItem {
  symbol: string
  ean?: string | null
  name?: string | null
  quantity: number
  available: number
  unit?: string | null
}

export interface StockPage {
  snapshot_at: string
  warehouses?: string[]
  items: StockItem[]
  next_cursor: string | null
  total: number
}

export interface BridgeEvent {
  id: number
  type: string
  occurred_at: string
  data: {
    order_id?: string | null
    document?: ContractDocument
    source?: "bridge" | "subiekt"
    symbols?: string[]
    [key: string]: unknown
  }
}

export interface EventsPage {
  events: BridgeEvent[]
  last_id: number
  has_more: boolean
  /** Newest id the bridge holds; lower than `after` means its feed was reset. */
  head_id?: number
}

export interface WebhookNudge {
  type: "events.available"
  last_id: number
  sent_at?: string
}

export interface BridgeErrorBody {
  error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> }
}

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

export type SubiektMode = "demo" | "live"
export type TaskKind = "order.create" | "order.cancel" | "order.fulfill"
export type TaskStatus = "waiting" | "pending" | "running" | "succeeded" | "failed" | "canceled"
export type RunKind = "stock" | "events" | "tasks" | "health"
export type RunTrigger = "schedule" | "manual" | "webhook" | "event" | "auto"
export type RunStatus = "success" | "partial" | "error" | "skipped"

export interface TaskDto {
  id: string
  kind: TaskKind
  orderId: string
  displayId: number | null
  status: TaskStatus
  trigger: string
  attempts: number
  nextAttemptAt: string | null
  lastError: string | null
  lastErrorCode: string | null
  reference: string | null
  documentNumber: string | null
  /** The bridge said a person has to finish the job in Subiekt (for example a cancel). */
  manualAction: boolean
  createdAt: string | null
  updatedAt: string | null
  succeededAt: string | null
}

export interface DocumentDto {
  id: string
  orderId: string | null
  displayId: number | null
  kind: string
  number: string
  status: string
  issuedAt: string | null
  source: string
  warehouse: string | null
  related: Array<{ kind: string; number: string }>
  createdAt: string | null
}

export interface RunDto {
  id: string
  kind: RunKind
  trigger: RunTrigger
  status: RunStatus
  dryRun: boolean
  message: string | null
  stats: Record<string, unknown> | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
}

export interface SubiektStatusResponse {
  mode: SubiektMode
  configured: boolean
  missing: string[]
  bridgeHost: string | null
  options: {
    prepaidProviders: string[]
    stockSyncEnabled: boolean
    stockLocationId: string | null
    stockField: "quantity" | "available"
    issueWzOnFulfillment: boolean
    fulfillOnWz: boolean
    eventsEnabled: boolean
  }
  connection: {
    reachable: boolean
    health: BridgeHealth | null
    checkedAt: string | null
    lastError: string | null
    lastErrorAt: string | null
    consecutiveFailures: number
    eventsCursor: string | null
    eventsReadAt: string | null
  }
  counts: {
    waiting: number
    pending: number
    running: number
    failed: number
    succeeded24h: number
    documents: number
    zk: number
    wz: number
  }
  lastRuns: Partial<Record<RunKind, RunDto>>
  running: RunKind[]
  schedules: { tasks: string; events: string; stock: string }
}

export interface TasksResponse {
  tasks: TaskDto[]
  count: number
  offset: number
  limit: number
}

export interface DocumentsResponse {
  documents: DocumentDto[]
  count: number
  offset: number
  limit: number
}

export interface RunsResponse {
  runs: RunDto[]
}

export interface OrderSubiektResponse {
  mode: SubiektMode
  orderId: string
  tasks: TaskDto[]
  documents: DocumentDto[]
}

export interface ActionResponse {
  started: boolean
  alreadyRunning?: boolean
  mode: SubiektMode
  message?: string
}
