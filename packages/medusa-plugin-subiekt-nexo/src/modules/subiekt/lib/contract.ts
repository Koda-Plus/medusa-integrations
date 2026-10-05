/**
 * TYPES OF THE BRIDGE CONTRACT, version 1.1 (`contract/openapi.yaml`).
 * Types only, no runtime code: files that import from here use `import type`,
 * which the unit tests' type stripping removes entirely.
 *
 * The second half describes what the admin receives from `/admin/subiekt/*`.
 */

import type { ReferenceDto } from "./references"

export type { ReferenceDto }

/* ------------------------------------------------------------------ */
/* Bridge contract                                                     */
/* ------------------------------------------------------------------ */

export type BridgeMode = "sfera" | "fake"

export interface BridgeHealth {
  status: "ok" | "degraded"
  /** Since 1.1. Absent: a 1.0 bridge (orders, fulfillments, stock, events). */
  capabilities?: string[]
  bridge: {
    name: string
    version: string
    contract: string
    mode: BridgeMode
    /** Since 1.1. */
    sdk_version?: string | null
    started_at?: string | null
  }
  subiekt: {
    connected: boolean
    product?: string | null
    version?: string | null
    database?: string | null
    /** Since 1.1. */
    database_version?: string | null
    /** Since 1.1: "ok", "refused" or "unknown". */
    licence?: string | null
    company?: string | null
    warehouse?: string | null
    checked_at?: string | null
    error?: string | null
  }
  /** Since 1.1. */
  events?: { last_id: number; last_at?: string | null } | null
  /** Since 1.1. */
  queues?: { sfera_pending: number; webhook_pending: number } | null
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

/** Since 1.1: the company buying. Only sent with a NIP that passed the checksum. */
export interface ContractBuyer {
  nip: string
  company_name: string | null
  address: ContractAddress | null
  email: string | null
  phone: string | null
  create_if_missing: boolean
}

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
  /** Since 1.1. */
  buyer: ContractBuyer | null
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
  /** Since 1.1: the KSeF number of an FS, when KSeF assigned one. */
  ksef_number?: string | null
  related?: Array<{ kind: string; number: string }>
}

/** Since 1.1. */
export interface BuyerResult {
  source: "existing" | "created" | "retail"
  nip?: string | null
  symbol?: string | null
  name?: string | null
}

export interface OrderResult {
  order_id: string
  created: boolean
  document: ContractDocument
  /** Since 1.1. */
  buyer?: BuyerResult | null
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

/** Since 1.1. */
export interface SalesDocumentRequest {
  kind: "fs" | "pa"
  display_id?: number | null
  note?: string | null
}

/** Since 1.1. */
export interface SalesDocumentResult {
  order_id: string
  created: boolean
  document: ContractDocument
  warnings?: string[]
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

/** Since 1.1. */
export interface PriceLevel {
  symbol: string
  name?: string | null
  currency?: string | null
}

/** Since 1.1. */
export interface ProductPrice {
  level: string
  net: number
  gross: number
  currency?: string | null
}

/** Since 1.1. */
export interface ProductItem {
  symbol: string
  name?: string | null
  ean?: string | null
  unit?: string | null
  vat_rate?: number | null
  vat_symbol?: string | null
  kind?: "goods" | "service" | "kit" | null
  active: boolean
  weight_kg?: number | null
  prices: ProductPrice[]
}

/** Since 1.1. */
export interface ProductsPage {
  snapshot_at: string
  price_levels: PriceLevel[]
  items: ProductItem[]
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
export type TaskKind = "order.create" | "order.cancel" | "order.fulfill" | "order.document"
/** `unknown`: the bridge may or may not have created the document; the next attempt asks before it creates. */
export type TaskStatus = "waiting" | "pending" | "running" | "unknown" | "succeeded" | "failed" | "canceled"
export type RunKind = "stock" | "events" | "tasks" | "health" | "products"
export type RunTrigger = "schedule" | "manual" | "webhook" | "event" | "auto"
export type RunStatus = "success" | "partial" | "error" | "skipped"
export type WriterKey = "prices" | "products" | "documents" | "contractors"

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
  /** Since 0.2.0: non-fatal remarks, for example an invalid NIP that sent the ZK to the retail buyer. */
  warnings: string[]
  /** Since 0.2.0: which contractor got the ZK. */
  buyer: BuyerResult | null
  /** Since 0.2.0: "fs" or "pa" for a sales document task. */
  documentKind: string | null
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
  /** Since 0.2.0. */
  ksefNumber: string | null
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

/** A writer: an option (the hard switch) and a runtime toggle a person flips. */
export interface WriterDto {
  key: WriterKey
  /** The option that must allow it, for example `priceWriter`. */
  option: string
  /** What the option says. False wins: the toggle cannot override it. */
  allowed: boolean
  /** The toggle in the database. */
  armed: boolean
  /** allowed AND armed AND (when it needs one) the bridge capability. */
  active: boolean
  /** The bridge cannot do it (a missing capability), whatever the switches say. */
  unsupported: boolean
  changedBy: string | null
  changedAt: string | null
}

export type SignatureState = "ok" | "invalid_signature" | "stale_timestamp" | "forbidden" | "unreachable" | "unknown"

/** Bridge diagnostics, from the last health check. */
export interface DiagnosticsDto {
  checkedAt: string | null
  latencyMs: number | null
  /** Bridge clock minus Medusa clock, corrected by half the latency. Positive: the bridge is ahead. */
  clockSkewMs: number | null
  signature: SignatureState
  /** As the bridge reported them, or the 1.0 set when it reports none. */
  capabilities: string[]
  /** The bridge did not report capabilities: contract 1.0. */
  legacy: boolean
  /** What this plugin can do and the bridge cannot, with the reason key for the admin. */
  missing: Array<{ capability: string; reason: string }>
  webhook: { lastAt: string | null; rejectedAt: string | null; rejectReason: string | null }
}

export type CatalogChangeKind = "price" | "create"
export type CatalogChangeStatus = "planned" | "applied" | "simulated" | "over_cap" | "failed" | "quarantined" | "stale" | "skipped"

export interface CatalogChangeDto {
  id: string
  kind: CatalogChangeKind
  status: CatalogChangeStatus
  symbol: string
  sku: string | null
  ean: string | null
  title: string | null
  variantId: string | null
  productId: string | null
  currency: string
  from: number | null
  to: number | null
  level: string | null
  matchedBy: string | null
  attempts: number
  lastError: string | null
  appliedAt: string | null
}

export interface QuarantineDto {
  id: string
  kind: CatalogChangeKind
  key: string
  failures: number
  lastError: string | null
  updatedAt: string | null
}

export interface ProductsResponse {
  changes: CatalogChangeDto[]
  count: number
  offset: number
  limit: number
  summary: Record<CatalogChangeStatus, number> & { total: number }
  run: RunDto | null
  quarantined: QuarantineDto[]
}

export interface SubiektStatusResponse {
  mode: SubiektMode
  configured: boolean
  missing: string[]
  /** Option values that stop one feature, for example `priceListId`. */
  optionWarnings: string[]
  bridgeHost: string | null
  pluginVersion: string
  contractVersion: string
  options: {
    prepaidProviders: string[]
    stockSyncEnabled: boolean
    stockLocationId: string | null
    stockField: "quantity" | "available"
    stockDryRun: boolean
    issueWzOnFulfillment: boolean
    fulfillOnWz: boolean
    eventsEnabled: boolean
    productSyncEnabled: boolean
    priceTarget: "variant" | "price_list"
    priceListId: string | null
    priceLevel: string | null
    priceType: "gross" | "net"
    priceCurrency: string
    maxPriceChangesPerRun: number
    maxProductsPerRun: number
    nipSources: string[]
    salesDocument: "none" | "fs" | "pa" | "auto"
    salesDocumentAfter: "wz" | "zk"
    /** A Cloudflare Access service token is set (never the token itself). */
    cfAccess: boolean
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
  diagnostics: DiagnosticsDto
  writers: WriterDto[]
  counts: {
    waiting: number
    pending: number
    running: number
    unknown: number
    failed: number
    succeeded24h: number
    documents: number
    zk: number
    wz: number
    fs: number
    pa: number
  }
  lastRuns: Partial<Record<RunKind, RunDto>>
  running: RunKind[]
  schedules: { tasks: string; events: string; stock: string; products: string }
  references: ReferenceDto[]
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
  /** Since 0.2.0: what a person can do from the order page. */
  salesDocument: {
    option: "none" | "fs" | "pa" | "auto"
    /** When the automatic document is due: after the WZ or right after the ZK. */
    after: "wz" | "zk"
    writerActive: boolean
    supported: boolean
  }
}

export interface ActionResponse {
  started: boolean
  alreadyRunning?: boolean
  mode: SubiektMode
  message?: string
}
