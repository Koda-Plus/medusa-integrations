import { BLOCKING_REASONS, WARNING_CODES, type BlockingReason, type WarningCode } from "./eligibility"
import { IMPORT_LEASE_MS } from "./orders"
import { LOG_KEEP_DAYS, MAX_EVENTS, OFFER_STATUSES, ORDER_STATUSES, SETTING_KEYS, TRACKING_STATUSES, VONHALSKY_MODULE, type ImportStatus, type OfferStatus, type TrackingStatus } from "./constants"
import type { EventDto, LogDto, MarketplaceOrderDto, OfferDto, OrderLineDto, VonHalskySettings } from "./contract"
import type { ResolvedVonHalskyOptions } from "./options"
import { fromMinor, parseMarkup } from "./pricing"
import { normalizeMapping } from "./shipping"

/**
 * The plugin's own rows, read and written from outside the module service
 * (the service stays thin): the settings, the rows as DTOs, the event
 * history and the sync log.
 */

export type Scope = { resolve: (key: string) => unknown }

export function vonHalskySvc(scope: Scope): any {
  return scope.resolve(VONHALSKY_MODULE)
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** The settings: what the admin saved, else the options, else the defaults. */
export function settingsFrom(rows: Array<{ key: string; value: unknown }>, o: Pick<ResolvedVonHalskyOptions, "markupPercent" | "salesChannelId" | "regionId" | "autoImport">): VonHalskySettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const pricing = (byKey.get(SETTING_KEYS.pricing) ?? {}) as Record<string, unknown>
  const orders = (byKey.get(SETTING_KEYS.orders) ?? {}) as Record<string, unknown>
  const markup = parseMarkup(pricing.markupPercent)
  const channel = typeof orders.salesChannelId === "string" && /^sc_[A-Za-z0-9]+$/.test(orders.salesChannelId) ? orders.salesChannelId : null
  const region = typeof orders.regionId === "string" && /^reg_[A-Za-z0-9]+$/.test(orders.regionId) ? orders.regionId : null
  return {
    pricing: { markupPercent: markup ?? o.markupPercent },
    orders: {
      salesChannelId: channel ?? o.salesChannelId,
      regionId: region ?? o.regionId,
      autoImport: typeof orders.autoImport === "boolean" ? orders.autoImport : o.autoImport,
    },
    shipping: normalizeMapping(byKey.get(SETTING_KEYS.shipping)),
  }
}

export async function readSettings(scope: Scope): Promise<VonHalskySettings> {
  const svc = vonHalskySvc(scope)
  const o = svc.getOptions() as ResolvedVonHalskyOptions
  try {
    const rows = ((await svc.listVonHalskySettings({})) ?? []) as Array<{ key: string; value: unknown }>
    return settingsFrom(rows, o)
  } catch {
    return settingsFrom([], o)
  }
}

export async function writeSetting(scope: Scope, key: string, value: unknown): Promise<void> {
  const svc = vonHalskySvc(scope)
  const rows = (await svc.listVonHalskySettings({ key })) ?? []
  if (Array.isArray(rows) && rows.length > 0) await svc.updateVonHalskySettings({ id: rows[0].id, value })
  else await svc.createVonHalskySettings({ key, value })
}

/* ------------------------------------------------------------------ */
/* DTOs                                                                */
/* ------------------------------------------------------------------ */

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

const codes = <T extends string>(v: unknown, known: readonly T[]): T[] => (Array.isArray(v) ? v.filter((x): x is T => typeof x === "string" && (known as readonly string[]).includes(x)) : [])

const oneOf = <T extends string>(v: unknown, known: readonly T[], fallback: T): T => (typeof v === "string" && (known as readonly string[]).includes(v) ? (v as T) : fallback)

const minor = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export function toOfferDto(row: Record<string, any>, extra: { thumbnail?: string | null } = {}): OfferDto {
  return {
    id: String(row.id),
    variant_id: String(row.variant_id ?? ""),
    product_id: String(row.product_id ?? ""),
    sku: row.sku ?? null,
    title: row.title ?? null,
    thumbnail: extra.thumbnail ?? null,
    status: oneOf<OfferStatus>(row.status, OFFER_STATUSES, "draft"),
    remote_status: row.remote_status ?? null,
    remote_id: row.remote_id ?? null,
    ean: row.ean ?? null,
    brand: row.brand ?? null,
    mpn: row.mpn ?? null,
    manufacturer: row.manufacturer ?? null,
    gpsr_source: row.gpsr_source === "compliance" || row.gpsr_source === "metadata" ? row.gpsr_source : null,
    reasons: codes<BlockingReason>(row.reasons, BLOCKING_REASONS),
    warnings: codes<WarningCode>(row.warnings, WARNING_CODES),
    base_price: fromMinor(minor(row.base_price_minor)),
    price_override: fromMinor(minor(row.price_override_minor)),
    price: fromMinor(minor(row.price_minor)),
    currency_code: String(row.currency_code ?? "pln"),
    stock: Number(row.stock) || 0,
    demo: row.demo === true,
    listed_at: iso(row.listed_at),
    synced_at: iso(row.synced_at),
    error: row.error ?? null,
  }
}

export function eventsOf(v: unknown): EventDto[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e) => ({
      at: typeof e.at === "string" ? e.at : new Date(0).toISOString(),
      kind: typeof e.kind === "string" ? e.kind : "note",
      message: typeof e.message === "string" ? e.message : "",
      ...(e.demo === true ? { demo: true } : {}),
    }))
}

/** The history with one more event, newest last, at most 40. */
export function withEvent(events: unknown, e: Omit<EventDto, "at"> & { at?: string }): EventDto[] {
  const list = eventsOf(events)
  list.push({ ...e, at: e.at ?? new Date().toISOString() })
  return list.slice(-MAX_EVENTS)
}

function linesOf(v: unknown): OrderLineDto[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
    .map((l) => ({
      offer_id: String(l.offer_id ?? ""),
      variant_id: String(l.variant_id ?? ""),
      sku: typeof l.sku === "string" ? l.sku : null,
      title: String(l.title ?? ""),
      quantity: Number(l.quantity) || 0,
      unit_price: fromMinor(minor(l.unit_price_minor)),
    }))
}

export function toOrderDto(row: Record<string, any>): MarketplaceOrderDto {
  return {
    id: String(row.id),
    marketplace_order_id: String(row.marketplace_order_id ?? ""),
    status: oneOf<ImportStatus>(row.status, ORDER_STATUSES, "held"),
    remote_status: row.remote_status ?? null,
    order_id: row.order_id ?? null,
    display_id: minor(row.display_id),
    demo: row.demo === true,
    delivery_type: row.delivery_type ?? null,
    delivery_point: row.delivery_point ?? null,
    shipping_option_id: row.shipping_option_id ?? null,
    payment_type: row.payment_type ?? null,
    currency_code: String(row.currency_code ?? "pln"),
    total: fromMinor(minor(row.total_minor)),
    lines: linesOf(row.lines),
    tracking_status: oneOf<TrackingStatus>(row.tracking_status, TRACKING_STATUSES, "none"),
    tracking_numbers: Array.isArray(row.tracking_numbers) ? row.tracking_numbers.map(String) : [],
    tracking_sent_at: iso(row.tracking_sent_at),
    imported_at: iso(row.imported_at),
    error: row.error ?? null,
    events: eventsOf(row.events),
    created_at: iso(row.created_at) ?? new Date(0).toISOString(),
    updated_at: iso(row.updated_at) ?? new Date(0).toISOString(),
  }
}

export function toLogDto(row: Record<string, any>): LogDto {
  return {
    id: String(row.id),
    area: String(row.area ?? ""),
    action: String(row.action ?? ""),
    outcome: row.outcome === "error" || row.outcome === "warning" ? row.outcome : "ok",
    message: String(row.message ?? ""),
    count: minor(row.count),
    demo: row.demo === true,
    created_at: iso(row.created_at) ?? new Date(0).toISOString(),
  }
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

/** The order rows a panel filter means. `errors`: held imports and tracking that failed. */
export function orderFilter(filter: string): Record<string, unknown> {
  switch (filter) {
    case "awaiting_shipment":
      return { status: "imported", tracking_status: ["none", "pending_api"] }
    case "tracking_sent":
      return { tracking_status: "sent" }
    case "held":
      return { status: "held" }
    case "errors":
      return { $or: [{ status: "held" }, { tracking_status: "failed" }] }
    default:
      return {}
  }
}

/** An `importing` row whose lease ran out counts as held (the attempt died). */
export function staleImport(row: { status: string; updated_at?: Date | string | null }, now = new Date()): boolean {
  if (row.status !== "importing") return false
  const at = row.updated_at ? new Date(row.updated_at).getTime() : 0
  return !Number.isFinite(at) || now.getTime() - at >= IMPORT_LEASE_MS
}

/* ------------------------------------------------------------------ */
/* The sync log                                                        */
/* ------------------------------------------------------------------ */

export interface LogInput {
  area: "offers" | "orders" | "tracking" | "settings"
  action: string
  outcome?: "ok" | "warning" | "error"
  message: string
  count?: number | null
  demo?: boolean
  refs?: Record<string, unknown> | null
}

let lastPrune = 0

/** One line in the sync log. Never throws: logging must not fail a flow. Prunes lines older than 30 days, at most once an hour. */
export async function logSync(scope: Scope, entry: LogInput): Promise<void> {
  try {
    const svc = vonHalskySvc(scope)
    await svc.createVonHalskySyncLogs({
      area: entry.area,
      action: entry.action,
      outcome: entry.outcome ?? "ok",
      message: entry.message.slice(0, 1000),
      count: entry.count ?? null,
      demo: entry.demo === true,
      refs: entry.refs ?? null,
    })
    if (Date.now() - lastPrune > 60 * 60 * 1000) {
      lastPrune = Date.now()
      const before = new Date(Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000)
      const old = (await svc.listVonHalskySyncLogs({ created_at: { $lt: before } }, { take: 500, select: ["id"] })) as Array<{ id: string }>
      if (old.length > 0) await svc.deleteVonHalskySyncLogs(old.map((r) => r.id))
    }
  } catch {
    /* the log is a convenience */
  }
}
