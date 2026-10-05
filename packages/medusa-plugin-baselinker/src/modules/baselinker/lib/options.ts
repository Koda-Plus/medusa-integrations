import {
  DEFAULT_COD_PROVIDERS,
  DEFAULT_MAX_STOCK_CHANGES,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_SKIP_METADATA_KEY,
  DEFAULT_TIMEOUT_MS,
  MAX_REQUESTS_PER_MINUTE,
} from "./constants"

/**
 * Options of `@koda-plus/medusa-plugin-baselinker`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-baselinker", options: { ... } }]
 *
 * Every key is optional. Missing values never break the boot: the module
 * registers, the admin lists what is missing and each job waits for the
 * options it needs (cards need the token and the catalog, orders need the
 * token and a status, stock needs the warehouse too).
 *
 * Numbers may come as strings (environment variables), lists as comma
 * separated strings.
 */
export type StockSyncMode = "off" | "plan" | "write"

export interface BaseLinkerPluginOptions {
  /** BaseLinker API token (Account, My account, API). Never leaves the server. */
  apiToken?: string
  /** BaseLinker catalog (inventory) id whose cards are linked to variants. */
  inventoryId?: number | string
  /** Warehouse whose stock counts, like `bl_12345`. A bare number becomes `bl_<number>`. */
  warehouseId?: string | number
  /** Status id new orders get in BaseLinker (`getOrderStatusList`). */
  orderStatusId?: number | string
  /** Optional custom order source id, so Medusa orders are labeled in BaseLinker. */
  customSourceId?: number | string
  /** Medusa stock location receiving BaseLinker stock. Optional when the store has one location. */
  stockLocationId?: string
  /** `off`, `plan` (default, nothing written) or `write`. */
  stockSync?: StockSyncMode
  /** Upper limit of inventory levels written by one run. Default 500. */
  maxStockChangesPerRun?: number | string
  /** Send `order.placed` orders to BaseLinker. Default true. */
  exportOrders?: boolean | string
  /** BaseLinker status ids that create the Medusa fulfillment for the remaining items. Default none. */
  fulfillOnStatusIds?: Array<number | string> | string
  /** BaseLinker status ids after which an order is closed and no longer read. Default none (30 days). */
  closedStatusIds?: Array<number | string> | string
  /** Payment provider id prefixes meaning cash on delivery. Default `pp_cod`, `pp_cash`. */
  codProviders?: string[] | string
  /**
   * Payment method names shown in BaseLinker, by provider id prefix, for
   * example `{ pp_cod: "Pobranie", pp_stripe: "Karta / BLIK" }`. They win over
   * the built-in English names. At most 30 characters each.
   */
  paymentLabels?: Record<string, string>
  /** `order.metadata[key] === true` never goes to BaseLinker. Default `baselinker_skip`. */
  skipOrderMetadataKey?: string
  /** Simulated BaseLinker built from your own catalog. Nothing leaves Medusa. */
  demo?: boolean | string
  /** Self-imposed rate limit. Default 80 per minute (BaseLinker allows 100). */
  requestsPerMinute?: number | string
  /** Timeout of one BaseLinker request in ms. Default 20000. */
  timeoutMs?: number | string
  /** Hourly card linking (and the stock plan after it). Default true. */
  catalogSyncEnabled?: boolean | string
}

export interface ResolvedBaseLinkerOptions {
  apiToken: string
  inventoryId: number | null
  warehouseId: string
  orderStatusId: number | null
  customSourceId: number | null
  stockLocationId: string
  stockSync: StockSyncMode
  maxStockChangesPerRun: number
  exportOrders: boolean
  fulfillOnStatusIds: number[]
  closedStatusIds: number[]
  codProviders: string[]
  paymentLabels: Array<[string, string]>
  skipOrderMetadataKey: string
  demo: boolean
  requestsPerMinute: number
  timeoutMs: number
  catalogSyncEnabled: boolean
}

/** BaseLinker warehouse keys look like `bl_123`, `shop_456` or `warehouse_789`. */
export const WAREHOUSE_PATTERN = /^[a-z]+_\d+$/

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "")

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return fallback
}

/** A positive integer id, or null. Accepts numbers and numeric strings. */
export function positiveInt(v: unknown): number | null {
  const s = str(v)
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function idList(v: unknown): number[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []
  const out: number[] = []
  for (const item of raw) {
    const n = positiveInt(item)
    if (n !== null && !out.includes(n)) out.push(n)
  }
  return out
}

function textList(v: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean)
  if (typeof v === "string" && v.trim()) return v.split(",").map((x) => x.trim()).filter(Boolean)
  return [...fallback]
}

function bounded(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** `bl_12345` stays, `12345` becomes `bl_12345`, anything else is kept as typed (and reported). */
export function normalizeWarehouseId(v: unknown): string {
  const s = str(v)
  if (/^\d+$/.test(s)) return `bl_${s}`
  return WAREHOUSE_PATTERN.test(s.toLowerCase()) ? s.toLowerCase() : s
}

/** Custom payment names, longest prefix first so `pp_stripe-blik` beats `pp_stripe`. */
function labelList(v: unknown): Array<[string, string]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>)
    .map(([prefix, label]) => [prefix.trim().toLowerCase(), String(label ?? "").trim().slice(0, 30)] as [string, string])
    .filter(([prefix, label]) => prefix && label)
    .sort((a, b) => b[0].length - a[0].length)
}

export function resolveOptions(o: BaseLinkerPluginOptions | undefined | null): ResolvedBaseLinkerOptions {
  const opts = o ?? {}
  const stockSync: StockSyncMode = opts.stockSync === "off" || opts.stockSync === "write" ? opts.stockSync : "plan"
  return {
    apiToken: str(opts.apiToken),
    inventoryId: positiveInt(opts.inventoryId),
    warehouseId: normalizeWarehouseId(opts.warehouseId),
    orderStatusId: positiveInt(opts.orderStatusId),
    customSourceId: positiveInt(opts.customSourceId),
    stockLocationId: str(opts.stockLocationId),
    stockSync,
    maxStockChangesPerRun: bounded(opts.maxStockChangesPerRun, DEFAULT_MAX_STOCK_CHANGES, 1, 100_000),
    exportOrders: bool(opts.exportOrders, true),
    fulfillOnStatusIds: idList(opts.fulfillOnStatusIds),
    closedStatusIds: idList(opts.closedStatusIds),
    codProviders: textList(opts.codProviders, DEFAULT_COD_PROVIDERS),
    paymentLabels: labelList(opts.paymentLabels),
    skipOrderMetadataKey: str(opts.skipOrderMetadataKey) || DEFAULT_SKIP_METADATA_KEY,
    demo: bool(opts.demo, false),
    requestsPerMinute: bounded(opts.requestsPerMinute, DEFAULT_REQUESTS_PER_MINUTE, 1, MAX_REQUESTS_PER_MINUTE),
    timeoutMs: bounded(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120_000),
    catalogSyncEnabled: bool(opts.catalogSyncEnabled, true),
  }
}

export function isValidWarehouseId(id: string): boolean {
  return WAREHOUSE_PATTERN.test(id)
}

/**
 * Option names live mode still needs, for the admin. Empty in demo mode.
 * The warehouse matters only when stock is planned, the order status only
 * when orders are exported.
 */
export function missingOptions(o: ResolvedBaseLinkerOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!o.apiToken) missing.push("apiToken")
  if (o.inventoryId === null) missing.push("inventoryId")
  if (o.stockSync !== "off") {
    if (!o.warehouseId) missing.push("warehouseId")
    else if (!isValidWarehouseId(o.warehouseId)) missing.push("warehouseId (like bl_12345)")
  }
  if (o.exportOrders && o.orderStatusId === null) missing.push("orderStatusId")
  return missing
}

/** Cards can be read: demo, or a token and a catalog. */
export function canReadCatalog(o: ResolvedBaseLinkerOptions): boolean {
  return o.demo || (Boolean(o.apiToken) && o.inventoryId !== null)
}

/** The stock plan can run: not off, and in live mode a readable catalog and a valid warehouse. */
export function canPlanStock(o: ResolvedBaseLinkerOptions): boolean {
  if (o.stockSync === "off") return false
  return o.demo || (canReadCatalog(o) && isValidWarehouseId(o.warehouseId))
}

/** Orders can be sent: export on, and in live mode a token and the status of new orders. */
export function canExportOrders(o: ResolvedBaseLinkerOptions): boolean {
  if (!o.exportOrders) return false
  return o.demo || (Boolean(o.apiToken) && o.orderStatusId !== null)
}

/** Sent orders can be followed: demo, or a token (the status read needs nothing else). */
export function canReadStatuses(o: ResolvedBaseLinkerOptions): boolean {
  return o.demo || Boolean(o.apiToken)
}
