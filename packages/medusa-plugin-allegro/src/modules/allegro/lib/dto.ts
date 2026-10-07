import { offerUrl, type AllegroEnvironment } from "./constants"
import type {
  AllegroImportDto,
  AllegroImportStatus,
  AllegroIssueDto,
  AllegroIssueKind,
  AllegroMoneyDto,
  AllegroOfferDto,
  AllegroOrderDto,
  AllegroOrderLineDto,
  AllegroOutboxDto,
  AllegroOutboxStatus,
  AllegroPlanItemDto,
  AllegroPlanKind,
  AllegroPlanStatus,
  AllegroRunDto,
  AllegroRunKind,
  AllegroStockState,
  AllegroWriterDto,
  AllegroWriterKey,
} from "./contract"
import { statusGroup } from "./matching"
import { orderGroup, type LinkedLine } from "./orders"
import { WRITERS, type WriterRow, type WriterState } from "./writers"

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
  dry_run?: boolean | null
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
  details?: Record<string, unknown> | null
  duration_ms: number
  started_at: Date | string
  finished_at: Date | string | null
}

/** `allegro_plan_item` row. */
export interface PlanItemRow {
  id: string
  kind: string
  target_key: string
  allegro_id: string | null
  variant_id: string | null
  product_id: string | null
  sku: string | null
  title: string | null
  action: string
  reason: string
  status: string
  current: Record<string, unknown> | null
  target: Record<string, unknown> | null
  failures: number
  last_error: string | null
  command_id: string | null
  planned_at: Date | string | null
  applied_at: Date | string | null
  demo: boolean
}

/** `allegro_order_import` row. */
export interface ImportRow {
  id: string
  checkout_form_id: string
  status: string
  source: string
  reason_code: string | null
  reason: string | null
  order_id: string | null
  display_id: number | null
  allegro_status: string | null
  fulfillment_status: string | null
  payment_type: string | null
  paid: boolean
  total: AllegroMoneyDto | null
  medusa_total: AllegroMoneyDto | null
  total_mismatch: boolean
  line_count: number
  bought_at: Date | string | null
  last_event_id: string | null
  last_event_type: string | null
  attempts: number
  next_attempt_at: Date | string | null
  claim_token?: string | null
  lease_until?: Date | string | null
  attention: string | null
  cancel_requested: boolean
  refresh_requested: boolean
  cancelled_on_allegro_at: Date | string | null
  imported_at: Date | string | null
  details: Record<string, unknown> | null
  demo: boolean
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

/** `allegro_outbox` row. */
export interface OutboxRow {
  id: string
  writer: string
  dedupe_key: string
  checkout_form_id: string
  order_id: string | null
  payload: Record<string, unknown> | null
  status: string
  attempts: number
  next_attempt_at: Date | string | null
  last_error: string | null
  result: Record<string, unknown> | null
  done_at: Date | string | null
  demo: boolean
  created_at?: Date | string | null
}

/** `allegro_issue` row. */
export interface IssueRow {
  id: string
  kind: string
  allegro_id: string
  checkout_form_id: string | null
  status: string
  reason_code: string | null
  reference_number: string | null
  opened_at: Date | string | null
  due_at: Date | string | null
  needs_reply: boolean
  is_open: boolean
  items: number
  last_message_at: Date | string | null
  demo: boolean
}

/**
 * JSON with keys sorted at every level. Postgres jsonb stores object keys in
 * its own order (shorter keys first), so comparing a stored json column with
 * a fresh object through JSON.stringify would see a change on every run.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
      )
    }
    return v ?? null
  }
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null))
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function money(m: AllegroMoneyDto | null | undefined): AllegroMoneyDto | null {
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

export function toOrderDto(r: OrderRow, env: AllegroEnvironment, imp: ImportRow | null = null): AllegroOrderDto {
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
    import: imp
      ? {
          id: imp.id,
          status: importStatus(imp.status),
          orderId: imp.order_id,
          displayId: imp.display_id ?? null,
          reasonCode: imp.reason_code,
          reason: imp.reason,
        }
      : null,
  }
}

const RUN_KINDS: readonly AllegroRunKind[] = ["offers", "orders", "stock", "prices", "import", "shipping", "invoices", "issues", "publish"]

export function toRunDto(r: RunRow): AllegroRunDto {
  return {
    id: r.id,
    kind: RUN_KINDS.includes(r.kind as AllegroRunKind) ? (r.kind as AllegroRunKind) : "offers",
    source: r.source === "demo" ? "demo" : "api",
    trigger: r.trigger === "schedule" || r.trigger === "auto" || r.trigger === "event" ? r.trigger : "manual",
    status: r.status === "ok" || r.status === "partial" || r.status === "skipped" ? r.status : "error",
    complete: Boolean(r.complete),
    dryRun: Boolean(r.dry_run),
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

export function toWriterDto(state: WriterState, row: WriterRow | null): AllegroWriterDto {
  return {
    key: state.key as AllegroWriterKey,
    allowed: state.allowed,
    armed: state.requested,
    effective: state.effective,
    blockers: state.blockers,
    missingScopes: state.missingScopes,
    modeChanged: state.modeChanged,
    writesAllegro: WRITERS[state.key].writesAllegro,
    changedBy: row?.changed_by ?? null,
    changedAt: iso(row?.changed_at),
    failureStreak: row?.failure_streak ?? 0,
    lastFailure: row?.last_failure ?? null,
    lastFailureAt: iso(row?.last_failure_at),
    trippedAt: iso(row?.tripped_at),
    tripReason: row?.trip_reason ?? null,
    lastRunAt: iso(row?.last_run_at),
    lastSuccessAt: iso(row?.last_success_at),
  }
}

const PLAN_STATUSES: readonly AllegroPlanStatus[] = ["planned", "skipped", "in_sync", "quarantined", "deferred", "applied", "failed", "unknown"]

export function toPlanItemDto(r: PlanItemRow, env: AllegroEnvironment): AllegroPlanItemDto {
  return {
    id: r.id,
    kind: (r.kind === "prices" || r.kind === "publish" ? r.kind : "stock") as AllegroPlanKind,
    targetKey: r.target_key,
    allegroId: r.allegro_id,
    url: r.allegro_id ? offerUrl(env, r.allegro_id) : null,
    variantId: r.variant_id,
    productId: r.product_id,
    sku: r.sku,
    title: r.title ?? r.sku ?? r.target_key,
    action: r.action,
    reason: r.reason,
    status: PLAN_STATUSES.includes(r.status as AllegroPlanStatus) ? (r.status as AllegroPlanStatus) : "skipped",
    current: r.current ?? null,
    target: r.target ?? null,
    failures: r.failures ?? 0,
    lastError: r.last_error,
    plannedAt: iso(r.planned_at),
    appliedAt: iso(r.applied_at),
    demo: Boolean(r.demo),
  }
}

const IMPORT_STATUSES: readonly AllegroImportStatus[] = ["pending", "importing", "imported", "held", "skipped", "cancelled", "unknown"]

export function importStatus(s: string): AllegroImportStatus {
  return IMPORT_STATUSES.includes(s as AllegroImportStatus) ? (s as AllegroImportStatus) : "pending"
}

function detailText(d: Record<string, unknown>, key: string): string | null {
  const v = d[key]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function toImportDto(r: ImportRow): AllegroImportDto {
  const d = r.details && typeof r.details === "object" ? r.details : {}
  /* A duplicate keeps the other integration's order in details (order_id names only our own orders): still linked in the list. */
  const dupId = detailText(d, "duplicate_order_id")
  const dupDisplay = Number(d.duplicate_display_id)
  return {
    id: r.id,
    checkoutFormId: r.checkout_form_id,
    status: importStatus(r.status),
    reasonCode: r.reason_code,
    reason: r.reason,
    orderId: r.order_id ?? dupId,
    displayId: r.display_id ?? (dupId && Number.isFinite(dupDisplay) ? dupDisplay : null),
    allegroStatus: r.allegro_status,
    fulfillmentStatus: r.fulfillment_status,
    paymentType: r.payment_type,
    paid: Boolean(r.paid),
    total: money(r.total),
    medusaTotal: money(r.medusa_total),
    totalMismatch: Boolean(r.total_mismatch),
    lineCount: r.line_count ?? 0,
    boughtAt: iso(r.bought_at),
    importedAt: iso(r.imported_at),
    attention: r.attention,
    source: r.source,
    attempts: r.attempts ?? 0,
    demo: Boolean(r.demo),
    updatedAt: iso(r.updated_at),
    buyerLogin: detailText(d, "buyer_login"),
    deliveryMethod: detailText(d, "delivery_method"),
    pickupPoint: detailText(d, "pickup_point_name") ?? detailText(d, "pickup_point_id"),
    handledAt: detailText(d, "handled_at"),
  }
}

const OUTBOX_STATUSES: readonly AllegroOutboxStatus[] = ["pending", "sending", "done", "failed", "unknown", "skipped"]

export function toOutboxDto(r: OutboxRow): AllegroOutboxDto {
  const p = r.payload ?? {}
  const kind = r.dedupe_key.startsWith("parcel:") ? "parcel" : r.dedupe_key.startsWith("status:") ? "status" : "invoice"
  const summary =
    kind === "parcel"
      ? `${String(p.waybill ?? "")} (${String(p.carrierName ?? p.carrierId ?? "")})`
      : kind === "status"
        ? String(p.status ?? "")
        : String(p.number ?? p.filename ?? "")
  return {
    id: r.id,
    writer: r.writer === "invoices" ? "invoices" : "shipping",
    kind,
    checkoutFormId: r.checkout_form_id,
    orderId: r.order_id,
    status: OUTBOX_STATUSES.includes(r.status as AllegroOutboxStatus) ? (r.status as AllegroOutboxStatus) : "pending",
    attempts: r.attempts ?? 0,
    lastError: r.last_error,
    summary,
    doneAt: iso(r.done_at),
    createdAt: iso(r.created_at),
    demo: Boolean(r.demo),
  }
}

export function toIssueDto(r: IssueRow, link: string, order: { id: string; display_id: number | null } | null): AllegroIssueDto {
  return {
    id: r.id,
    kind: (r.kind === "dispute" || r.kind === "claim" ? r.kind : "return") as AllegroIssueKind,
    allegroId: r.allegro_id,
    checkoutFormId: r.checkout_form_id,
    orderId: order?.id ?? null,
    displayId: order?.display_id ?? null,
    status: r.status,
    reasonCode: r.reason_code,
    referenceNumber: r.reference_number,
    openedAt: iso(r.opened_at),
    dueAt: iso(r.due_at),
    needsReply: Boolean(r.needs_reply),
    open: Boolean(r.is_open),
    items: r.items ?? 0,
    demo: Boolean(r.demo),
    link,
  }
}
