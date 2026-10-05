/**
 * Database rows as the generated service returns them, and their admin DTOs.
 * Dates leave as ISO strings; no table stores a secret.
 */

import {
  RUN_KINDS,
  type CardConflict,
  type CardDto,
  type ImportDto,
  type ImportStatus,
  type InvoiceDto,
  type InvoiceRowStatus,
  type OrderDto,
  type OrderRowStatus,
  type PlanAction,
  type PlanChange,
  type PlanItemDto,
  type PlanKind,
  type PlanStatus,
  type ReturnDto,
  type ReturnProductDto,
  type RunDto,
  type RunKind,
  type StockChangeDto,
  type StockChangeStatus,
} from "./contract"

export interface ProductRow {
  id: string
  bl_product_id: string
  parent_id: string | null
  sku: string | null
  ean: string | null
  name: string
  stock: number | null
  price: Record<string, number> | null
  match_key: string | null
  match_source: string | null
  variant_id: string | null
  product_id: string | null
  variant_sku: string | null
  product_title: string | null
  conflict: string | null
  demo: boolean
  updated_at?: Date | string | null
}

export interface OrderRow {
  id: string
  order_id: string
  display_id: number | null
  status: string
  bl_order_id: string | null
  attempts: number
  next_attempt_at: Date | string | null
  last_error: string | null
  last_error_code: string | null
  sent_at: Date | string | null
  bl_status_id: number | null
  bl_status_name: string | null
  tracking_number: string | null
  tracking_url: string | null
  carrier: string | null
  status_checked_at: Date | string | null
  fulfilled_at: Date | string | null
  demo: boolean
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export interface StockChangeRow {
  id: string
  run_id: string | null
  variant_id: string
  product_id: string | null
  sku: string | null
  product_title: string | null
  bl_product_id: string
  inventory_item_id: string
  location_id: string
  level_id: string | null
  medusa_stocked: number | null
  medusa_reserved: number
  bl_stock: number
  target: number
  delta: number
  kind: string
  status: string
  after_stocked: number | null
  applied_at: Date | string | null
  demo: boolean
  created_at?: Date | string | null
}

export interface RunRow {
  id: string
  kind: string
  source: string
  trigger: string
  status: string
  complete: boolean
  counts: Record<string, unknown> | null
  message: string | null
  duration_ms: number
  started_at: Date | string
  finished_at: Date | string | null
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

const CONFLICTS: readonly string[] = ["duplicate_sku", "duplicate_ean", "ambiguous_variant"]
const ORDER_STATUSES: readonly string[] = ["pending", "sent", "failed", "skipped"]
const CHANGE_STATUSES: readonly string[] = ["planned", "applied", "over_cap", "failed"]

export function toCardDto(r: ProductRow): CardDto {
  return {
    id: r.id,
    blProductId: r.bl_product_id,
    parentId: r.parent_id ?? null,
    sku: r.sku ?? null,
    ean: r.ean ?? null,
    name: r.name ?? "",
    stock: r.stock ?? null,
    price: r.price && typeof r.price === "object" && !Array.isArray(r.price) ? r.price : null,
    matchKey: r.match_key ?? null,
    matchSource: r.match_source === "sku" || r.match_source === "ean" ? r.match_source : null,
    variantId: r.variant_id ?? null,
    productId: r.product_id ?? null,
    variantSku: r.variant_sku ?? null,
    productTitle: r.product_title ?? null,
    conflict: r.conflict && CONFLICTS.includes(r.conflict) ? (r.conflict as CardConflict) : null,
    demo: Boolean(r.demo),
    updatedAt: iso(r.updated_at),
    isContainer: r.match_source === "parent",
  }
}

export function toOrderDto(r: OrderRow): OrderDto {
  return {
    id: r.id,
    orderId: r.order_id,
    displayId: r.display_id ?? null,
    status: (ORDER_STATUSES.includes(r.status) ? r.status : "pending") as OrderRowStatus,
    blOrderId: r.bl_order_id ?? null,
    attempts: r.attempts ?? 0,
    nextAttemptAt: iso(r.next_attempt_at),
    lastError: r.last_error ?? null,
    lastErrorCode: r.last_error_code ?? null,
    sentAt: iso(r.sent_at),
    blStatusId: r.bl_status_id ?? null,
    blStatusName: r.bl_status_name ?? null,
    trackingNumber: r.tracking_number ?? null,
    trackingUrl: r.tracking_url ?? null,
    carrier: r.carrier ?? null,
    statusCheckedAt: iso(r.status_checked_at),
    fulfilledAt: iso(r.fulfilled_at),
    demo: Boolean(r.demo),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toStockChangeDto(r: StockChangeRow): StockChangeDto {
  return {
    id: r.id,
    variantId: r.variant_id,
    productId: r.product_id ?? null,
    sku: r.sku ?? null,
    productTitle: r.product_title ?? null,
    blProductId: r.bl_product_id,
    inventoryItemId: r.inventory_item_id,
    locationId: r.location_id,
    levelId: r.level_id ?? null,
    medusaStocked: r.medusa_stocked ?? null,
    medusaReserved: r.medusa_reserved ?? 0,
    blStock: r.bl_stock ?? 0,
    target: r.target ?? 0,
    delta: r.delta ?? 0,
    kind: r.kind === "create" ? "create" : "update",
    status: (CHANGE_STATUSES.includes(r.status) ? r.status : "planned") as StockChangeStatus,
    afterStocked: r.after_stocked ?? null,
    appliedAt: iso(r.applied_at),
    createdAt: iso(r.created_at),
  }
}

export function toRunDto(r: RunRow): RunDto {
  const kind: RunKind = (RUN_KINDS as readonly string[]).includes(r.kind) ? (r.kind as RunKind) : "catalog"
  return {
    id: r.id,
    kind,
    source: r.source === "demo" ? "demo" : "api",
    trigger: r.trigger === "schedule" || r.trigger === "auto" ? r.trigger : "manual",
    status: r.status === "ok" || r.status === "partial" ? r.status : "error",
    complete: Boolean(r.complete),
    counts: r.counts ?? {},
    message: r.message ?? null,
    durationMs: r.duration_ms ?? 0,
    startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
    finishedAt: iso(r.finished_at),
  }
}

/* ------------------------------------------------------------------ */
/* 0.2                                                                 */
/* ------------------------------------------------------------------ */

export interface SettingRow {
  id: string
  key: string
  value: unknown
  demo: boolean
  changed_by: string | null
  changed_by_label: string | null
  changed_at: Date | string | null
}

export interface PlanItemRow {
  id: string
  kind: string
  run_id: string | null
  item_key: string
  action: string
  status: string
  reason: string | null
  label: string | null
  sku: string | null
  product_id: string | null
  variant_id: string | null
  bl_product_id: string | null
  changes: unknown
  error: string | null
  applied_at: Date | string | null
  demo: boolean
  created_at?: Date | string | null
}

export interface QuarantineRow {
  id: string
  kind: string
  item_key: string
  label: string | null
  failures: number
  last_error: string | null
  quarantined_at: Date | string | null
  released_at: Date | string | null
  released_by: string | null
  demo: boolean
}

export interface ImportRow {
  id: string
  bl_order_id: string
  source: string
  source_id: string | null
  external_order_id: string | null
  marketplace_ref: string | null
  status: string
  order_id: string | null
  display_id: number | null
  attempts: number
  next_attempt_at: Date | string | null
  last_error: string | null
  last_error_code: string | null
  confirmed_at: Date | string | null
  total_minor: number | null
  currency: string | null
  lines: number
  unlinked_lines: number
  payment_state: string | null
  bl_status_id: number | null
  bl_status_name: string | null
  tracking_number: string | null
  tracking_url: string | null
  carrier: string | null
  status_checked_at: Date | string | null
  flag: string | null
  imported_at: Date | string | null
  canceled_at: Date | string | null
  fulfilled_at: Date | string | null
  demo: boolean
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export interface ReturnRow {
  id: string
  bl_return_id: string
  bl_order_id: string | null
  order_id: string | null
  display_id: number | null
  source: string | null
  external_return_id: string | null
  status_id: number | null
  status_name: string | null
  fulfillment_status: number | null
  refunded_minor: number | null
  currency: string | null
  products: unknown
  created_in_bl_at: Date | string | null
  status_changed_at: Date | string | null
  demo: boolean
}

export interface InvoiceRow {
  id: string
  document_id: string
  external_id: string | null
  order_id: string
  display_id: number | null
  bl_order_id: string | null
  kind: string
  number: string | null
  field: string
  status: string
  attempts: number
  next_attempt_at: Date | string | null
  last_error: string | null
  last_error_code: string | null
  written_at: Date | string | null
  demo: boolean
  created_at?: Date | string | null
}

const PLAN_KIND_LIST: readonly string[] = ["catalog_import", "cards", "stock_push", "prices"]
const PLAN_ACTIONS: readonly string[] = ["create", "update", "draft", "skip", "conflict"]
const PLAN_STATUSES: readonly string[] = ["planned", "applied", "failed", "over_cap", "quarantined", "info"]
const IMPORT_STATUSES: readonly string[] = ["pending", "imported", "skipped", "failed"]
const INVOICE_STATUSES: readonly string[] = ["pending", "written", "conflict", "skipped", "failed"]

/** Minor units (grosze, cents) to a number with two decimals. */
export function fromMinor(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) / 100 : null
}

/** A number with two decimals to minor units. */
export function toMinor(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null
}

function changeList(value: unknown): PlanChange[] {
  if (!Array.isArray(value)) return []
  const out: PlanChange[] = []
  const val = (x: unknown): string | number | null => (typeof x === "number" || typeof x === "string" ? x : null)
  for (const c of value) {
    if (!c || typeof c !== "object") continue
    const v = c as Record<string, unknown>
    if (typeof v.field === "string") out.push({ field: v.field, from: val(v.from), to: val(v.to) })
  }
  return out
}

export function toPlanItemDto(r: PlanItemRow, q?: QuarantineRow | null): PlanItemDto {
  return {
    id: r.id,
    kind: (PLAN_KIND_LIST.includes(r.kind) ? r.kind : "cards") as PlanKind,
    itemKey: r.item_key,
    action: (PLAN_ACTIONS.includes(r.action) ? r.action : "skip") as PlanAction,
    status: (PLAN_STATUSES.includes(r.status) ? r.status : "planned") as PlanStatus,
    reason: r.reason ?? null,
    label: r.label ?? null,
    sku: r.sku ?? null,
    productId: r.product_id ?? null,
    variantId: r.variant_id ?? null,
    blProductId: r.bl_product_id ?? null,
    changes: changeList(r.changes),
    error: r.error ?? null,
    appliedAt: iso(r.applied_at),
    demo: Boolean(r.demo),
    createdAt: iso(r.created_at),
    quarantine: q ? { id: q.id, failures: q.failures ?? 0, quarantinedAt: iso(q.quarantined_at), lastError: q.last_error ?? null } : null,
  }
}

export function toImportDto(r: ImportRow): ImportDto {
  return {
    id: r.id,
    blOrderId: r.bl_order_id,
    source: r.source,
    sourceId: r.source_id ?? null,
    externalOrderId: r.external_order_id ?? null,
    marketplaceRef: r.marketplace_ref ?? null,
    status: (IMPORT_STATUSES.includes(r.status) ? r.status : "pending") as ImportStatus,
    orderId: r.order_id ?? null,
    displayId: r.display_id ?? null,
    attempts: r.attempts ?? 0,
    nextAttemptAt: iso(r.next_attempt_at),
    lastError: r.last_error ?? null,
    lastErrorCode: r.last_error_code ?? null,
    confirmedAt: iso(r.confirmed_at),
    total: fromMinor(r.total_minor),
    currency: r.currency ?? null,
    lines: r.lines ?? 0,
    unlinkedLines: r.unlinked_lines ?? 0,
    paymentState: r.payment_state ?? null,
    blStatusId: r.bl_status_id ?? null,
    blStatusName: r.bl_status_name ?? null,
    trackingNumber: r.tracking_number ?? null,
    trackingUrl: r.tracking_url ?? null,
    carrier: r.carrier ?? null,
    flag: r.flag ?? null,
    importedAt: iso(r.imported_at),
    canceledAt: iso(r.canceled_at),
    fulfilledAt: iso(r.fulfilled_at),
    demo: Boolean(r.demo),
    createdAt: iso(r.created_at),
  }
}

function returnProducts(value: unknown): ReturnProductDto[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const v = p as Record<string, unknown>
      return {
        name: typeof v.name === "string" ? v.name : "",
        sku: typeof v.sku === "string" && v.sku ? v.sku : null,
        quantity: typeof v.quantity === "number" ? v.quantity : 0,
        price: typeof v.price === "number" ? v.price : null,
        reason: typeof v.reason === "string" && v.reason ? v.reason : null,
      }
    })
}

export function toReturnDto(r: ReturnRow): ReturnDto {
  return {
    id: r.id,
    blReturnId: r.bl_return_id,
    blOrderId: r.bl_order_id ?? null,
    orderId: r.order_id ?? null,
    displayId: r.display_id ?? null,
    source: r.source ?? null,
    externalReturnId: r.external_return_id ?? null,
    statusId: r.status_id ?? null,
    statusName: r.status_name ?? null,
    fulfillmentStatus: r.fulfillment_status ?? null,
    refunded: fromMinor(r.refunded_minor),
    currency: r.currency ?? null,
    products: returnProducts(r.products),
    createdInBlAt: iso(r.created_in_bl_at),
    statusChangedAt: iso(r.status_changed_at),
    demo: Boolean(r.demo),
  }
}

export function toInvoiceDto(r: InvoiceRow): InvoiceDto {
  return {
    id: r.id,
    documentId: r.document_id,
    orderId: r.order_id,
    displayId: r.display_id ?? null,
    blOrderId: r.bl_order_id ?? null,
    kind: r.kind,
    number: r.number ?? null,
    field: r.field,
    status: (INVOICE_STATUSES.includes(r.status) ? r.status : "pending") as InvoiceRowStatus,
    attempts: r.attempts ?? 0,
    lastError: r.last_error ?? null,
    lastErrorCode: r.last_error_code ?? null,
    writtenAt: iso(r.written_at),
    demo: Boolean(r.demo),
    createdAt: iso(r.created_at),
  }
}
