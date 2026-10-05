import type {
  OlxAdvertDto,
  OlxAlertDto,
  OlxAlertKind,
  OlxPlanItemDto,
  OlxPlanState,
  OlxProblemDto,
  OlxPublicationDto,
  OlxPublicationState,
  OlxRunDto,
  OlxThreadDto,
  OlxWriterKey,
  OlxWriterRunDto,
  OlxWriterRunItemDto,
} from "./contract"
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
  category_id?: number | null
  stats_views?: number | null
  stats_phone_views?: number | null
  stats_observers?: number | null
  stats_at?: Date | string | null
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

export interface AlertRow {
  id: string
  key: string
  kind: string
  variant_id: string
  product_id: string
  sku: string | null
  product_title: string | null
  olx_id: string | null
  advert_title: string | null
  advert_url: string | null
  advert_status: string | null
  stock: number | null
  product_status: string | null
  first_seen_at: Date | string | null
  demo: boolean
}

export interface PlanItemRow {
  id: string
  writer: string
  olx_id: string
  action: string
  reason: string | null
  from_value: unknown
  to_value: unknown
  approved_value: unknown
  state: string
  attempts: number
  last_error: string | null
  note: string | null
  planned_at: Date | string | null
  last_attempt_at: Date | string | null
  done_at: Date | string | null
  paused_at: Date | string | null
  unknown_since: Date | string | null
  claim_token?: string | null
  lease_until?: Date | string | null
  title: string | null
  variant_id: string | null
  product_id: string | null
  sku: string | null
  demo: boolean
  updated_at?: Date | string | null
}

export interface PublicationRow {
  id: string
  variant_id: string
  product_id: string
  sku: string
  title: string
  olx_category_id: number | null
  state: string
  payload: unknown
  missing: unknown
  warnings: unknown
  attempts: number
  last_error: string | null
  note: string | null
  planned_at: Date | string | null
  last_attempt_at: Date | string | null
  unknown_since: Date | string | null
  olx_id: string | null
  olx_url: string | null
  olx_status: string | null
  adopted: boolean
  published_at: Date | string | null
  demo: boolean
  updated_at?: Date | string | null
}

export interface WriterRunRow {
  id: string
  writer: string
  mode: string
  trigger: string
  status: string
  planned: number
  attempted: number
  succeeded: number
  failed: number
  quarantined: number
  unknown: number
  skipped: number
  message: string | null
  items: unknown
  actor: string | null
  duration_ms: number
  started_at: Date | string
  finished_at: Date | string | null
  demo: boolean
}

export interface ThreadRow {
  id: string
  thread_key: string
  advert_olx_id: string | null
  unread_count: number
  total_count: number
  olx_created_at: Date | string | null
  is_favourite: boolean
  demo: boolean
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function toAdvertDto(r: AdvertRow): OlxAdvertDto {
  const source = r.match_source === "external_id" || r.match_source === "description" ? r.match_source : null
  const statsAt = iso(r.stats_at)
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
    categoryId: numOrNull(r.category_id),
    stats: statsAt
      ? { views: numOrNull(r.stats_views), phoneViews: numOrNull(r.stats_phone_views), observers: numOrNull(r.stats_observers), at: statsAt }
      : null,
    alert: null,
    unread: 0,
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

const ALERT_KINDS: readonly OlxAlertKind[] = ["live_sold_out", "live_unpublished", "stock_not_live", "stock_not_listed"]

export function toAlertDto(r: AlertRow): OlxAlertDto {
  return {
    id: r.id,
    kind: (ALERT_KINDS as readonly string[]).includes(r.kind) ? (r.kind as OlxAlertKind) : "stock_not_live",
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    productTitle: r.product_title,
    olxId: r.olx_id,
    advertTitle: r.advert_title,
    advertUrl: r.advert_url,
    advertStatus: r.advert_status,
    stock: numOrNull(r.stock),
    productStatus: r.product_status,
    firstSeenAt: iso(r.first_seen_at),
    demo: Boolean(r.demo),
  }
}

const PLAN_STATES: readonly OlxPlanState[] = ["idle", "pending", "held", "applying", "done", "failed", "quarantined", "unknown"]

export function toPlanItemDto(r: PlanItemRow): OlxPlanItemDto {
  return {
    id: r.id,
    writer: r.writer === "price" ? "price" : "lifecycle",
    olxId: r.olx_id,
    action: r.action,
    reason: r.reason,
    from: r.from_value ?? null,
    to: r.to_value ?? null,
    state: (PLAN_STATES as readonly string[]).includes(r.state) ? (r.state as OlxPlanState) : "idle",
    attempts: r.attempts ?? 0,
    lastError: r.last_error,
    note: r.note,
    plannedAt: iso(r.planned_at),
    lastAttemptAt: iso(r.last_attempt_at),
    doneAt: iso(r.done_at),
    pausedAt: iso(r.paused_at),
    title: r.title,
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    demo: Boolean(r.demo),
  }
}

const PUBLICATION_STATES: readonly OlxPublicationState[] = ["planned", "blocked", "publishing", "published", "failed", "quarantined", "unknown"]

function problems(v: unknown): OlxProblemDto[] {
  if (!Array.isArray(v)) return []
  const out: OlxProblemDto[] = []
  for (const p of v) {
    if (!p || typeof p !== "object") continue
    const code = String((p as Record<string, unknown>).code ?? "").trim()
    if (!code) continue
    const detail = (p as Record<string, unknown>).detail
    out.push(detail === undefined || detail === null ? { code } : { code, detail: String(detail) })
  }
  return out
}

export function toPublicationDto(r: PublicationRow): OlxPublicationDto {
  return {
    id: r.id,
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    title: r.title,
    olxCategoryId: numOrNull(r.olx_category_id),
    state: (PUBLICATION_STATES as readonly string[]).includes(r.state) ? (r.state as OlxPublicationState) : "blocked",
    missing: problems(r.missing),
    warnings: problems(r.warnings),
    payload: r.payload && typeof r.payload === "object" && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : null,
    attempts: r.attempts ?? 0,
    lastError: r.last_error,
    note: r.note,
    plannedAt: iso(r.planned_at),
    olxId: r.olx_id,
    olxUrl: r.olx_url,
    olxStatus: r.olx_status,
    adopted: Boolean(r.adopted),
    publishedAt: iso(r.published_at),
    demo: Boolean(r.demo),
  }
}

function runItems(v: unknown): OlxWriterRunItemDto[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const o = x as Record<string, unknown>
      const s = (k: string): string | null => (o[k] === null || o[k] === undefined ? null : String(o[k]))
      return { action: String(o.action ?? ""), olxId: s("olxId"), variantId: s("variantId"), outcome: String(o.outcome ?? ""), detail: s("detail") }
    })
}

export function toWriterRunDto(r: WriterRunRow): OlxWriterRunDto {
  const writer: OlxWriterKey = r.writer === "price" || r.writer === "publish" ? r.writer : "lifecycle"
  const status = ["ok", "partial", "error", "skipped", "held"].includes(r.status) ? (r.status as OlxWriterRunDto["status"]) : "error"
  return {
    id: r.id,
    writer,
    mode: r.mode === "apply" ? "apply" : "dry_run",
    trigger: r.trigger === "schedule" || r.trigger === "auto" ? r.trigger : "manual",
    status,
    planned: r.planned ?? 0,
    attempted: r.attempted ?? 0,
    succeeded: r.succeeded ?? 0,
    failed: r.failed ?? 0,
    quarantined: r.quarantined ?? 0,
    unknown: r.unknown ?? 0,
    skipped: r.skipped ?? 0,
    message: r.message,
    items: runItems(r.items),
    actor: r.actor,
    durationMs: r.duration_ms ?? 0,
    startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
    finishedAt: iso(r.finished_at),
    demo: Boolean(r.demo),
  }
}

export function toThreadDto(r: ThreadRow, advert: Pick<AdvertRow, "title" | "url" | "product_id" | "product_title" | "sku"> | null): OlxThreadDto {
  return {
    id: r.id,
    key: r.thread_key,
    advertOlxId: r.advert_olx_id,
    advertTitle: advert?.title ?? null,
    advertUrl: advert?.url ?? null,
    productId: advert?.product_id ?? null,
    productTitle: advert?.product_title ?? null,
    sku: advert?.sku ?? null,
    unread: r.unread_count ?? 0,
    total: r.total_count ?? 0,
    createdAt: iso(r.olx_created_at),
    favourite: Boolean(r.is_favourite),
    demo: Boolean(r.demo),
  }
}
