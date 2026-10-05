/**
 * Database rows as the generated service returns them, and their admin DTOs.
 * Dates leave as ISO strings; no table stores a secret.
 */

import type {
  CardConflict,
  CardDto,
  OrderDto,
  OrderRowStatus,
  RunDto,
  StockChangeDto,
  StockChangeStatus,
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
  const kind = r.kind === "stock" || r.kind === "orders" || r.kind === "statuses" ? r.kind : "catalog"
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
