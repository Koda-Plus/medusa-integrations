import type { OlxAdvertDto, OlxRunDto } from "./contract"
import { statusGroup } from "./matching"

/** `olx_advert` row as the generated service returns it. */
export interface AdvertRow {
  id: string
  olx_id: string
  title: string
  url: string
  status: string
  external_id: string | null
  description_sku: string | null
  match_key: string | null
  match_source: string | null
  variant_id: string | null
  product_id: string | null
  sku: string | null
  product_title: string | null
  is_primary: boolean
  price: { value: number; currency: string } | null
  valid_to: Date | string | null
  olx_created_at: Date | string | null
  demo: boolean
  updated_at?: Date | string | null
}

/** `olx_sync_run` row. */
export interface RunRow {
  id: string
  source: string
  trigger: string
  status: string
  complete: boolean
  pages: number
  adverts: number
  statuses: Record<string, number> | null
  linked: number
  linked_live: number
  unmatched_live: number
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

export function toAdvertDto(r: AdvertRow): OlxAdvertDto {
  const source = r.match_source === "external_id" || r.match_source === "description" ? r.match_source : null
  return {
    id: r.id,
    olxId: r.olx_id,
    title: r.title,
    url: r.url,
    status: r.status,
    statusGroup: statusGroup(r.status),
    price: r.price && typeof r.price === "object" ? { value: Number(r.price.value), currency: String(r.price.currency) } : null,
    externalId: r.external_id,
    descriptionSku: r.description_sku,
    matchKey: r.match_key,
    matchSource: source,
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    productTitle: r.product_title,
    isPrimary: Boolean(r.is_primary),
    demo: Boolean(r.demo),
    validTo: iso(r.valid_to),
    olxCreatedAt: iso(r.olx_created_at),
    updatedAt: iso(r.updated_at),
  }
}

export function toRunDto(r: RunRow): OlxRunDto {
  return {
    id: r.id,
    source: r.source === "demo" ? "demo" : "api",
    trigger: r.trigger === "schedule" || r.trigger === "auto" ? r.trigger : "manual",
    status: r.status === "ok" || r.status === "partial" ? r.status : "error",
    complete: Boolean(r.complete),
    pages: r.pages ?? 0,
    adverts: r.adverts ?? 0,
    statuses: r.statuses ?? {},
    linked: r.linked ?? 0,
    linkedLive: r.linked_live ?? 0,
    unmatchedLive: r.unmatched_live ?? 0,
    created: r.created_count ?? 0,
    updated: r.updated_count ?? 0,
    removed: r.removed_count ?? 0,
    message: r.message,
    durationMs: r.duration_ms ?? 0,
    startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
    finishedAt: iso(r.finished_at),
  }
}
