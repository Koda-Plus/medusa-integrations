import { offerUrl, type AllegroEnvironment } from "./constants"
import type {
  AllegroMoneyDto,
  AllegroOfferDto,
  AllegroOrderDto,
  AllegroOrderLineDto,
  AllegroRunDto,
  AllegroStockState,
} from "./contract"
import { statusGroup } from "./matching"
import { orderGroup, type LinkedLine } from "./orders"

/** `allegro_offer` row as the generated service returns it. */
export interface OfferRow {
  id: string
  allegro_id: string
  name: string
  status: string
  external_id: string | null
  match_key: string | null
  variant_id: string | null
  product_id: string | null
  sku: string | null
  product_title: string | null
  is_primary: boolean
  price: AllegroMoneyDto | null
  available: number | null
  sold: number | null
  medusa_available: number | null
  stock_state: string | null
  format: string | null
  category_id: string | null
  started_at: Date | string | null
  ending_at: Date | string | null
  ended_by: string | null
  demo: boolean
  updated_at?: Date | string | null
}

/** `allegro_order` row. */
export interface OrderRow {
  id: string
  allegro_id: string
  status: string
  fulfillment_status: string | null
  total: AllegroMoneyDto | null
  bought_at: Date | string | null
  allegro_updated_at: Date | string | null
  delivery_method: string | null
  line_count: number
  unmatched_lines: number
  lines: LinkedLine[] | null
  demo: boolean
}

/** `allegro_sync_run` row. */
export interface RunRow {
  id: string
  kind: string
  source: string
  trigger: string
  status: string
  complete: boolean
  pages: number
  items: number
  statuses: Record<string, number> | null
  linked: number
  linked_live: number
  unmatched_live: number
  issues: number
  created_count: number
  updated_count: number
  removed_count: number
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

function money(m: AllegroMoneyDto | null | undefined): AllegroMoneyDto | null {
  if (!m || typeof m !== "object") return null
  const value = Number(m.value)
  return Number.isFinite(value) ? { value, currency: String(m.currency) } : null
}

const STOCK_STATES: readonly AllegroStockState[] = [
  "oversell",
  "sold_out",
  "under_listed",
  "ended_in_stock",
  "ok",
  "untracked",
  "unknown",
]

export function toOfferDto(r: OfferRow, env: AllegroEnvironment): AllegroOfferDto {
  const state = STOCK_STATES.includes(r.stock_state as AllegroStockState) ? (r.stock_state as AllegroStockState) : null
  return {
    id: r.id,
    allegroId: r.allegro_id,
    name: r.name,
    url: offerUrl(env, r.allegro_id),
    status: r.status,
    statusGroup: statusGroup(r.status),
    price: money(r.price),
    available: r.available ?? null,
    sold: r.sold ?? null,
    medusaAvailable: r.medusa_available ?? null,
    stockState: state,
    externalId: r.external_id,
    matchKey: r.match_key,
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    productTitle: r.product_title,
    isPrimary: Boolean(r.is_primary),
    demo: Boolean(r.demo),
    format: r.format,
    startedAt: iso(r.started_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toOrderDto(r: OrderRow, env: AllegroEnvironment): AllegroOrderDto {
  const lines: AllegroOrderLineDto[] = (Array.isArray(r.lines) ? r.lines : []).map((l) => ({
    offerId: l.offerId,
    offerName: l.offerName,
    offerUrl: offerUrl(env, l.offerId),
    externalId: l.externalId ?? null,
    quantity: Number(l.quantity) || 1,
    price: money(l.price),
    variantId: l.variantId ?? null,
    productId: l.productId ?? null,
    sku: l.sku ?? null,
    productTitle: l.productTitle ?? null,
  }))
  return {
    id: r.id,
    allegroId: r.allegro_id,
    status: r.status,
    fulfillmentStatus: r.fulfillment_status,
    group: orderGroup(r.status, r.fulfillment_status),
    total: money(r.total),
    boughtAt: iso(r.bought_at),
    updatedAt: iso(r.allegro_updated_at),
    deliveryMethod: r.delivery_method,
    lines,
    unmatchedLines: r.unmatched_lines ?? 0,
    demo: Boolean(r.demo),
  }
}

export function toRunDto(r: RunRow): AllegroRunDto {
  return {
    id: r.id,
    kind: r.kind === "orders" ? "orders" : "offers",
    source: r.source === "demo" ? "demo" : "api",
    trigger: r.trigger === "schedule" || r.trigger === "auto" ? r.trigger : "manual",
    status: r.status === "ok" || r.status === "partial" ? r.status : "error",
    complete: Boolean(r.complete),
    pages: r.pages ?? 0,
    items: r.items ?? 0,
    statuses: r.statuses ?? {},
    linked: r.linked ?? 0,
    linkedLive: r.linked_live ?? 0,
    unmatchedLive: r.unmatched_live ?? 0,
    issues: r.issues ?? 0,
    created: r.created_count ?? 0,
    updated: r.updated_count ?? 0,
    removed: r.removed_count ?? 0,
    message: r.message,
    durationMs: r.duration_ms ?? 0,
    startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
    finishedAt: iso(r.finished_at),
  }
}
