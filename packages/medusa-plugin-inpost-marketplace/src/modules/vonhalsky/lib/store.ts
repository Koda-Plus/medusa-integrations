import { CONNECTION_OK, connectionStateOf, connectionView, nextConnectionState, type ConnectionState } from "./connection"
import { BLOCKING_REASONS, WARNING_CODES, type BlockingReason, type WarningCode } from "./eligibility"
import { plainText } from "./offer-payload"
import { OVERRIDE_FIELDS, overriddenFields, overridesOf, type OfferDimension } from "./overrides"
import { IMPORT_LEASE_MS } from "./orders"
import { CASE_KINDS, LOG_KEEP_DAYS, MAX_EVENTS, OFFER_STATUSES, ORDER_STATUSES, SETTING_KEYS, TRACKING_STATUSES, VONHALSKY_MODULE, type CaseKind, type ImportStatus, type OfferStatus, type TrackingStatus } from "./constants"
import type { CaseDto, CaseLineDto, EventDto, LogDto, MarketplaceOrderDto, OfferDefaults, OfferDto, OrderLineDto, ParcelDto, PromotionDto, VonHalskySettings } from "./contract"
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
/** Medusa category id to marketplace leaf id; anything else is dropped. */
export function categoryMapOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const [k, id] of Object.entries(v as Record<string, unknown>)) {
    if (/^pcat_[A-Za-z0-9]+$/.test(k) && typeof id === "string" && /^[A-Za-z0-9-]{1,80}$/.test(id)) out[k] = id
  }
  return out
}

const policy = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 5000) : "")

export function offerDefaultsOf(v: unknown, o: Pick<ResolvedVonHalskyOptions, "daysToShip" | "syncPriceStock">): OfferDefaults {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
  const days = Number(d.daysToShip)
  return {
    daysToShip: Number.isInteger(days) && days >= 0 && days <= 60 ? days : o.daysToShip,
    returnPolicy: policy(d.returnPolicy),
    complaintPolicy: policy(d.complaintPolicy),
    syncPriceStock: typeof d.syncPriceStock === "boolean" ? d.syncPriceStock : o.syncPriceStock,
  }
}

export function settingsFrom(rows: Array<{ key: string; value: unknown }>, o: Pick<ResolvedVonHalskyOptions, "markupPercent" | "salesChannelId" | "regionId" | "autoImport" | "daysToShip" | "syncPriceStock">): VonHalskySettings {
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
    categories: categoryMapOf(byKey.get(SETTING_KEYS.categories)),
    offerDefaults: offerDefaultsOf(byKey.get(SETTING_KEYS.offerDefaults), o),
  }
}

/** Where the sync stands: the newest event ids seen and the time of the last runs. */
export interface SyncState {
  offerEventId: string | null
  orderEventId: string | null
  /** ISO times of the last run of each part. */
  at: Record<string, string>
}

export async function readSyncState(scope: Scope): Promise<SyncState> {
  try {
    const rows = ((await vonHalskySvc(scope).listVonHalskySettings({ key: SETTING_KEYS.sync })) ?? []) as Array<{ value: unknown }>
    const v = (rows[0]?.value ?? {}) as Record<string, unknown>
    const at = v.at && typeof v.at === "object" ? (v.at as Record<string, unknown>) : {}
    return {
      offerEventId: typeof v.offerEventId === "string" ? v.offerEventId : null,
      orderEventId: typeof v.orderEventId === "string" ? v.orderEventId : null,
      at: Object.fromEntries(Object.entries(at).filter((e): e is [string, string] => typeof e[1] === "string")),
    }
  } catch {
    return { offerEventId: null, orderEventId: null, at: {} }
  }
}

export async function writeSyncState(scope: Scope, patch: Partial<SyncState>): Promise<void> {
  const now = await readSyncState(scope)
  await writeSetting(scope, SETTING_KEYS.sync, { ...now, ...patch, at: { ...now.at, ...(patch.at ?? {}) } })
}

/** Whether the marketplace still takes the credentials (see `connection.ts`). Never throws. */
export async function readConnection(scope: Scope): Promise<ConnectionState> {
  try {
    const rows = ((await vonHalskySvc(scope).listVonHalskySettings({ key: SETTING_KEYS.connection })) ?? []) as Array<{ value: unknown }>
    return connectionStateOf(rows[0]?.value)
  } catch {
    return { ...CONNECTION_OK }
  }
}

/**
 * Records one run or check: refused (`{ refused: message }`), reached, or
 * null (nothing was asked of the marketplace: the state stays). The first
 * refusal that raises the alert and the first success after it go to the
 * sync log. Never throws: the record must not fail a sync.
 */
export async function recordConnection(scope: Scope, outcome: Parameters<typeof nextConnectionState>[1], demo = false): Promise<ConnectionState> {
  try {
    if (!outcome) return await readConnection(scope)
    const prev = await readConnection(scope)
    /* Connected and known to be: no write every five minutes. */
    if ("reached" in outcome && prev.failures === 0 && prev.okAt) return prev
    const next = nextConnectionState(prev, outcome)
    await writeSetting(scope, SETTING_KEYS.connection, next)
    const was = connectionView(prev).ok
    const now = connectionView(next).ok
    if (was && !now) await logSync(scope, { area: "sync", action: "connection", outcome: "error", message: `InPost Von Halsky refused the credentials ${next.failures} times in a row since ${next.since}: ${next.message ?? ""}`, demo })
    if (!was && now) await logSync(scope, { area: "sync", action: "connection", message: "InPost Von Halsky takes the credentials again.", demo })
    return next
  } catch {
    return { ...CONNECTION_OK }
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

const jsonObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

function promotionOf(v: unknown): PromotionDto | null {
  const p = jsonObj(v)
  if (!p) return null
  const mode = p.mode === "PERCENTAGE" || p.mode === "FIXED_PRICE" || p.mode === "AMOUNT" ? p.mode : null
  return { start: str(p.start), end: str(p.end), status: str(p.status), mode, value: typeof p.value === "number" ? p.value : null }
}

function parcelsOf(v: unknown): ParcelDto[] {
  if (!Array.isArray(v)) return []
  return v
    .map(jsonObj)
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p!.trackingNumber === "string")
    .map((p) => ({ trackingNumber: String(p.trackingNumber), createdAt: str(p.createdAt), status: str(p.status) }))
}

/** What Medusa gives for the editable fields (the catalog's `EditableFacts`), when the caller read it. */
export interface MedusaEditable {
  title: string | null
  description: string | null
  images: string[]
  dimension: OfferDimension | null
}

/**
 * The edit fields of an offer: what a person set, what Medusa (and the
 * offer defaults) give, and what the marketplace gets. Medusa's side is only
 * known when the caller read it; the description is shown as the plain text
 * the marketplace receives.
 */
export function offerEditOf(overrides: unknown, medusa: MedusaEditable | null | undefined, defaultDays: number | null | undefined): Pick<OfferDto, "overrides" | "overridden" | "medusa" | "effective"> {
  const o = overridesOf(overrides)
  const set: OfferDto["overrides"] = { title: o.title ?? null, description: o.description ?? null, images: o.images ?? null, dimension: o.dimension ?? null, daysToShip: o.daysToShip ?? null }
  const base: OfferDto["medusa"] = medusa ? { title: medusa.title, description: medusa.description ? plainText(medusa.description) : null, images: medusa.images, dimension: medusa.dimension ? { ...medusa.dimension } : null, daysToShip: defaultDays ?? null } : null
  const effective: OfferDto["effective"] = base ? Object.fromEntries(OVERRIDE_FIELDS.map((f) => [f, set[f] ?? base[f]])) as unknown as OfferDto["effective"] : null
  return { overrides: set, overridden: overriddenFields(o), medusa: base, effective }
}

export function toOfferDto(row: Record<string, any>, extra: { thumbnail?: string | null; categoryPath?: string | null; medusa?: MedusaEditable | null; daysToShip?: number | null } = {}): OfferDto {
  const hint = jsonObj(row.hint)
  const cmdStatus = row.command_status === "PENDING" || row.command_status === "SUCCESS" || row.command_status === "FAILURE" ? row.command_status : null
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
    category_id: row.category_id ?? null,
    category_path: extra.categoryPath ?? null,
    category_source: row.category_source === "map" || row.category_source === "hint" || row.category_source === "manual" ? row.category_source : null,
    hint: hint ? { productId: str(hint.productId), categoryId: str(hint.categoryId), name: str(hint.name), brand: str(hint.brand) } : null,
    remote_price: fromMinor(minor(row.remote_price_minor)),
    remote_final_price: fromMinor(minor(row.remote_final_price_minor)),
    remote_stock: minor(row.remote_stock),
    promotion: promotionOf(row.promotion),
    program: row.program === "IN" || row.program === "OUT" ? row.program : null,
    validation: Array.isArray(row.validation)
      ? row.validation
          .map(jsonObj)
          .filter((v: Record<string, unknown> | null): v is Record<string, unknown> => Boolean(v))
          .map((v: Record<string, unknown>) => ({ code: String(v.code ?? "UNKNOWN"), message: str(v.message) }))
      : [],
    command: row.command_id && cmdStatus ? { id: String(row.command_id), kind: String(row.command_kind ?? ""), status: cmdStatus, at: iso(row.command_at) } : null,
    image_count: minor(row.image_count),
    published_at: iso(row.published_at),
    attributes: Array.isArray(row.attributes)
      ? row.attributes
          .filter((a: unknown): a is { id: unknown; values: unknown } => Boolean(a) && typeof a === "object")
          .map((a: { id: unknown; values: unknown }) => ({ id: String(a.id), values: Array.isArray(a.values) ? a.values.map(String) : [] }))
      : [],
    ...offerEditOf(row.overrides, extra.medusa, extra.daysToShip),
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
    parcels: parcelsOf(row.parcels),
    imported_at: iso(row.imported_at),
    placed_at: iso(row.placed_at),
    paid_at: iso(row.paid_at),
    shipped_at: iso(row.shipped_at),
    expected_delivery_at: iso(row.expected_delivery_at),
    buyer_kind: row.buyer_kind ?? null,
    delivery: fromMinor(minor(row.delivery_minor)),
    refunded: fromMinor(minor(row.refunded_minor)),
    returns_count: Number(row.returns_count) || 0,
    claims_count: Number(row.claims_count) || 0,
    error: row.error ?? null,
    events: eventsOf(row.events),
    created_at: iso(row.created_at) ?? new Date(0).toISOString(),
    updated_at: iso(row.updated_at) ?? new Date(0).toISOString(),
  }
}

function caseLinesOf(v: unknown): CaseLineDto[] {
  if (!Array.isArray(v)) return []
  return v
    .map(jsonObj)
    .filter((l): l is Record<string, unknown> => Boolean(l))
    .map((l) => ({ offerId: str(l.offerId), name: str(l.name), ean: str(l.ean), quantity: Number(l.quantity) || 1, price: fromMinor(minor(l.priceMinor)), reason: str(l.reason) }))
}

/** Whether the seller has to act on a case. */
export function caseOpen(row: { kind: string; status?: string | null; sub_status?: string | null; source?: string | null }): boolean {
  if (row.kind === "return") return row.status === "NEW"
  if (row.kind === "claim") return !row.sub_status && row.status !== "APPROVED" && row.status !== "REJECTED"
  return row.sub_status === "DECLINED"
}

export function toCaseDto(row: Record<string, any>, order: { order_id: string | null; display_id: number | null } | null = null): CaseDto {
  return {
    id: String(row.id),
    kind: oneOf<CaseKind>(row.kind, CASE_KINDS, "return"),
    remote_id: String(row.remote_id ?? ""),
    display_id: row.display_id ?? null,
    marketplace_order_id: row.marketplace_order_id ?? null,
    order_id: order?.order_id ?? null,
    display_order_id: order?.display_id ?? null,
    status: row.status ?? null,
    sub_status: row.sub_status ?? null,
    source: row.source ?? null,
    reason: row.reason ?? null,
    amount: fromMinor(minor(row.amount_minor)),
    lines: caseLinesOf(row.lines),
    refund_id: row.refund_id ?? null,
    opened_at: iso(row.opened_at),
    expires_at: iso(row.expires_at),
    decided_at: iso(row.decided_at),
    open: caseOpen({ kind: String(row.kind), status: row.status, sub_status: row.sub_status, source: row.source }),
    demo: row.demo === true,
    events: eventsOf(row.events),
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

/** The order rows a panel filter means. `errors`: held imports. */
export function orderFilter(filter: string): Record<string, unknown> {
  switch (filter) {
    case "awaiting_shipment":
      return { status: "imported", shipped_at: null, remote_status: { $nin: ["CANCELED", "REFUSED", "REJECTED"] } }
    case "tracking_waiting":
      return { tracking_status: "waiting" }
    case "held":
    case "errors":
      return { status: "held" }
    default:
      return {}
  }
}

/** The offer rows a panel filter means. `pending`: the marketplace keeps them PENDING or REJECTED. */
export function offerFilter(filter: string): Record<string, unknown> {
  if (filter === "pending") return { remote_status: ["PENDING", "REJECTED"], status: { $ne: "closed" } }
  return (OFFER_STATUSES as readonly string[]).includes(filter) ? { status: filter } : {}
}

/** The case rows a panel filter means. */
export function caseFilter(filter: string): Record<string, unknown> {
  if ((CASE_KINDS as readonly string[]).includes(filter)) return { kind: filter }
  if (filter === "open") return { $or: [{ kind: "return", status: "NEW" }, { kind: "claim", sub_status: null, status: { $nin: ["APPROVED", "REJECTED"] } }, { kind: "refund", sub_status: "DECLINED" }] }
  return {}
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
  area: "offers" | "orders" | "tracking" | "settings" | "cases" | "categories" | "sync"
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
