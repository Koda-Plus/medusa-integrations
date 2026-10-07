import {
  DEFAULT_COD_PROVIDERS,
  DEFAULT_IMPORT_MAX_AGE_HOURS,
  DEFAULT_IMPORT_OPTION_TITLE,
  DEFAULT_INVOICE_FIELD,
  DEFAULT_INVOICE_KINDS,
  DEFAULT_MAX_CATALOG_CHANGES,
  DEFAULT_MAX_PRICE_CHANGES,
  DEFAULT_MAX_STOCK_CHANGES,
  DEFAULT_QUARANTINE_AFTER,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_RETURNS_WINDOW_DAYS,
  DEFAULT_SKIP_METADATA_KEY,
  DEFAULT_TIMEOUT_MS,
  MAX_REQUESTS_PER_MINUTE,
} from "./constants"
import { resolveReferences, type ReferenceInput, type ResolvedReference } from "./references"
import { WRITER_KEYS, type WriterKey } from "./writers"

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

/** Where the catalog is managed. Prices follow the catalog. */
export type CatalogSource = "medusa" | "baselinker"

/** Which side's stock is the truth. */
export type StockSource = "baselinker" | "medusa"

export type ManufacturerTarget = "metadata" | "tag"
export type WeightUnit = "g" | "kg"
export type JournalMode = "auto" | "off"

/** One order source to import: a type (`allegro`) or a type and an account id (`allegro:1455`). */
export interface OrderSourceRule {
  type: string
  id: number | null
}

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
  /**
   * Simulated BaseLinker built from your own catalog. Nothing leaves Medusa.
   * Only an explicit `true` (or the string "true") switches it on: a missing
   * token never does.
   */
  demo?: boolean | string
  /**
   * Demo mode only: simulated marketplace orders become real Medusa orders
   * (flagged `metadata.baselinker_demo`) once the order import writer is
   * armed. Default false: they stay rows of the import list.
   */
  demoCreatesOrders?: boolean | string
  /** Self-imposed rate limit. Default 80 per minute (BaseLinker allows 100). */
  requestsPerMinute?: number | string
  /** Timeout of one BaseLinker request in ms. Default 20000. */
  timeoutMs?: number | string
  /** Hourly card linking (and the stock plan after it). Default true. */
  catalogSyncEnabled?: boolean | string

  /* ---- 0.2: directions -------------------------------------------- */

  /**
   * Where the catalog lives. `medusa` (default, the 0.1 behaviour): cards are
   * linked, and an armed writer creates missing cards in BaseLinker.
   * `baselinker`: BaseLinker products are imported into Medusa by an armed
   * writer, after a plan. Prices follow the catalog.
   */
  catalogSource?: CatalogSource
  /** Which stock is the truth. `baselinker` (default): BaseLinker to Medusa. `medusa`: Medusa to the BaseLinker warehouse. */
  stockSource?: StockSource
  /** The BaseLinker price group: read by the catalog import, written by the price push. */
  priceGroupId?: number | string
  /** Medusa currency of that price group. Default `pln`. */
  priceCurrency?: string
  /**
   * Hard switches of the writers. `false` wins and cannot be overridden from
   * the admin; anything else lets a person arm the writer there.
   * Keys: catalogImport, cards, stockToMedusa, stockToBaseLinker, prices,
   * orderImport, invoiceNumbers.
   */
  writers?: Partial<Record<WriterKey, boolean | string>>
  /** Catalog changes (imported products, created or updated cards) per run. Default 200. */
  maxCatalogChangesPerRun?: number | string
  /** Price changes per run. Default 1000. */
  maxPriceChangesPerRun?: number | string
  /** Failed runs of one item before it is quarantined. Default 3. */
  quarantineAfter?: number | string

  /* ---- 0.2: catalog import (catalogSource: "baselinker") ------------ */

  /** Status of products the import creates. Default `published`. */
  catalogImportStatus?: "published" | "draft"
  /** Sales channel of imported products. Default: the store's default sales channel. */
  catalogImportSalesChannelId?: string
  /** Shipping profile of imported products. Default: the store's default profile. */
  catalogImportShippingProfileId?: string
  /** Option title of imported products with several variants. Default `Variant`. */
  catalogImportOptionTitle?: string
  /** Create Medusa categories that do not exist yet (matched by name). Default false. */
  createMissingCategories?: boolean | string
  /** Where the manufacturer goes: `metadata` (default, `metadata.manufacturer`) or `tag`. */
  manufacturerAs?: ManufacturerTarget
  /** An imported product removed in BaseLinker becomes a draft in Medusa. Default false: only reported. */
  draftRemovedProducts?: boolean | string
  /** Unit of Medusa variant weights. BaseLinker uses kilograms. Default `g`. */
  weightUnit?: WeightUnit

  /* ---- 0.2: marketplace orders into Medusa -------------------------- */

  /**
   * Order sources imported into Medusa: types or `type:id`, for example
   * `["allegro", "amazon:7245"]` or `"allegro,erli"`. Default none: nothing is imported.
   */
  orderImportSources?: string[] | string
  /** Sales channel of imported orders. Default: the store's default sales channel. */
  orderImportSalesChannelId?: string
  /** Region of imported orders. Default: the region of the order currency. */
  orderImportRegionId?: string
  /** Shipping option of imported orders (lets fulfillOnStatusIds fulfill them). Optional. */
  orderImportShippingOptionId?: string
  /** BaseLinker statuses that cancel the imported Medusa order (when nothing is fulfilled). */
  orderImportCancelStatusIds?: Array<number | string> | string
  /** First discovery reads orders confirmed since this date (ISO). Default: 24 hours before the first discovery. */
  orderImportSince?: string
  /** Orders older than this when the writer reaches them are skipped. Default 72. */
  orderImportMaxAgeHours?: number | string
  /** Orders other plugins imported from a marketplace (`marketplace_order_ref`) go to BaseLinker too. Default false. */
  exportMarketplaceOrders?: boolean | string

  /* ---- 0.2: returns, journal, invoice numbers, references ----------- */

  /** Read returns (read only). Default true. */
  returnsSync?: boolean | string
  /** Returns of the last N days. Default 30. */
  returnsWindowDays?: number | string
  /** `auto` (default): the order journal when BaseLinker has it on, the full read otherwise. `off`: always the full read. */
  journal?: JournalMode
  /** BaseLinker order field for invoice numbers: `extra_field_1` (default), `extra_field_2` or a custom extra field id. */
  invoiceNumberField?: string | number
  /** Fakturownia kinds whose number is written. Default `vat`, `receipt`. */
  invoiceNumberKinds?: string[] | string
  /** Stores running this integration, shown in the admin ("Running in production"). */
  references?: ReferenceInput[]
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
  demoCreatesOrders: boolean
  requestsPerMinute: number
  timeoutMs: number
  catalogSyncEnabled: boolean
  catalogSource: CatalogSource
  stockSource: StockSource
  priceGroupId: number | null
  priceCurrency: string
  /** Writers switched off by the options (`false`). */
  writersOff: WriterKey[]
  maxCatalogChangesPerRun: number
  maxPriceChangesPerRun: number
  quarantineAfter: number
  catalogImportStatus: "published" | "draft"
  catalogImportSalesChannelId: string
  catalogImportShippingProfileId: string
  catalogImportOptionTitle: string
  createMissingCategories: boolean
  manufacturerAs: ManufacturerTarget
  draftRemovedProducts: boolean
  weightUnit: WeightUnit
  orderImportSources: OrderSourceRule[]
  orderImportSalesChannelId: string
  orderImportRegionId: string
  orderImportShippingOptionId: string
  orderImportCancelStatusIds: number[]
  /** Unix seconds, or null. */
  orderImportSince: number | null
  orderImportMaxAgeHours: number
  exportMarketplaceOrders: boolean
  returnsSync: boolean
  returnsWindowDays: number
  journal: JournalMode
  /** `extra_field_1`, `extra_field_2` or `custom:<id>`. */
  invoiceNumberField: string
  invoiceNumberKinds: string[]
  references: ResolvedReference[]
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

/**
 * Order sources to import: `allegro`, `allegro:1455`, `amazon:7245`. Types are
 * lowercased BaseLinker source codes; an id narrows to one account. Junk is
 * dropped, duplicates are kept once.
 */
export function parseOrderSources(v: unknown): OrderSourceRule[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []
  const out: OrderSourceRule[] = []
  for (const item of raw) {
    const text = str(item).toLowerCase()
    const m = /^([a-z][a-z0-9_]{0,29})(?::(\d+))?$/.exec(text)
    if (!m) continue
    const rule: OrderSourceRule = { type: m[1], id: m[2] !== undefined ? Number(m[2]) : null }
    if (!out.some((r) => r.type === rule.type && r.id === rule.id)) out.push(rule)
  }
  return out
}

/** `extra_field_1`, `extra_field_2`, or a custom extra field id (`135` or `custom:135`). Anything else falls back to the default. */
export function parseInvoiceField(v: unknown): string {
  const text = str(v).toLowerCase()
  if (text === "extra_field_1" || text === "extra_field_2") return text
  const m = /^(?:custom:)?(\d+)$/.exec(text)
  if (m && Number(m[1]) > 0) return `custom:${Number(m[1])}`
  return DEFAULT_INVOICE_FIELD
}

function writersOff(v: unknown): WriterKey[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  const map = v as Record<string, unknown>
  return WRITER_KEYS.filter((key) => key in map && bool(map[key], true) === false)
}

/** ISO date or date-time to unix seconds; junk is null. */
function unixFrom(v: unknown): number | null {
  const text = str(v)
  if (!text) return null
  const t = new Date(text).getTime()
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

export function resolveOptions(o: BaseLinkerPluginOptions | undefined | null): ResolvedBaseLinkerOptions {
  const opts = o ?? {}
  const stockSync: StockSyncMode = opts.stockSync === "off" || opts.stockSync === "write" ? opts.stockSync : "plan"
  const kinds = textList(opts.invoiceNumberKinds, DEFAULT_INVOICE_KINDS).map((k) => k.toLowerCase())
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
    demoCreatesOrders: bool(opts.demoCreatesOrders, false),
    requestsPerMinute: bounded(opts.requestsPerMinute, DEFAULT_REQUESTS_PER_MINUTE, 1, MAX_REQUESTS_PER_MINUTE),
    timeoutMs: bounded(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120_000),
    catalogSyncEnabled: bool(opts.catalogSyncEnabled, true),
    catalogSource: opts.catalogSource === "baselinker" ? "baselinker" : "medusa",
    stockSource: opts.stockSource === "medusa" ? "medusa" : "baselinker",
    priceGroupId: positiveInt(opts.priceGroupId),
    priceCurrency: (/^[a-z]{3}$/i.test(str(opts.priceCurrency)) ? str(opts.priceCurrency) : "pln").toLowerCase(),
    writersOff: writersOff(opts.writers),
    maxCatalogChangesPerRun: bounded(opts.maxCatalogChangesPerRun, DEFAULT_MAX_CATALOG_CHANGES, 1, 10_000),
    maxPriceChangesPerRun: bounded(opts.maxPriceChangesPerRun, DEFAULT_MAX_PRICE_CHANGES, 1, 100_000),
    quarantineAfter: bounded(opts.quarantineAfter, DEFAULT_QUARANTINE_AFTER, 1, 100),
    catalogImportStatus: opts.catalogImportStatus === "draft" ? "draft" : "published",
    catalogImportSalesChannelId: str(opts.catalogImportSalesChannelId),
    catalogImportShippingProfileId: str(opts.catalogImportShippingProfileId),
    catalogImportOptionTitle: str(opts.catalogImportOptionTitle).slice(0, 60) || DEFAULT_IMPORT_OPTION_TITLE,
    createMissingCategories: bool(opts.createMissingCategories, false),
    manufacturerAs: opts.manufacturerAs === "tag" ? "tag" : "metadata",
    draftRemovedProducts: bool(opts.draftRemovedProducts, false),
    weightUnit: opts.weightUnit === "kg" ? "kg" : "g",
    orderImportSources: parseOrderSources(opts.orderImportSources),
    orderImportSalesChannelId: str(opts.orderImportSalesChannelId),
    orderImportRegionId: str(opts.orderImportRegionId),
    orderImportShippingOptionId: str(opts.orderImportShippingOptionId),
    orderImportCancelStatusIds: idList(opts.orderImportCancelStatusIds),
    orderImportSince: unixFrom(opts.orderImportSince),
    orderImportMaxAgeHours: bounded(opts.orderImportMaxAgeHours, DEFAULT_IMPORT_MAX_AGE_HOURS, 1, 24 * 365),
    exportMarketplaceOrders: bool(opts.exportMarketplaceOrders, false),
    returnsSync: bool(opts.returnsSync, true),
    returnsWindowDays: bounded(opts.returnsWindowDays, DEFAULT_RETURNS_WINDOW_DAYS, 1, 365),
    journal: opts.journal === "off" ? "off" : "auto",
    invoiceNumberField: parseInvoiceField(opts.invoiceNumberField),
    invoiceNumberKinds: kinds.length > 0 ? [...new Set(kinds)] : [...DEFAULT_INVOICE_KINDS],
    references: resolveReferences(opts.references),
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
    else if (o.stockSource === "medusa" && !isBaseWarehouse(o.warehouseId)) missing.push("warehouseId (a bl_ warehouse to receive Medusa stock)")
  }
  if (o.exportOrders && o.orderStatusId === null) missing.push("orderStatusId")
  return missing
}

/** BaseLinker's own warehouses (`bl_<id>`) accept stock; warehouses of shops and wholesalers do not. */
export function isBaseWarehouse(id: string): boolean {
  return /^bl_\d+$/.test(id)
}

/** Stock can be pushed to BaseLinker: a readable catalog and a `bl_` warehouse (demo: always). */
export function canPushStock(o: ResolvedBaseLinkerOptions): boolean {
  if (o.stockSync === "off") return false
  return o.demo || (canReadCatalog(o) && isBaseWarehouse(o.warehouseId))
}

/** Prices can be pushed: a readable catalog and a price group (demo: always). */
export function canPushPrices(o: ResolvedBaseLinkerOptions): boolean {
  return o.demo || (canReadCatalog(o) && o.priceGroupId !== null)
}

/** Marketplace orders can be imported: demo, or a token and at least one source. */
export function canImportOrders(o: ResolvedBaseLinkerOptions): boolean {
  return o.demo || (Boolean(o.apiToken) && o.orderImportSources.length > 0)
}

/** Returns can be read: on, and demo or a token. */
export function canReadReturns(o: ResolvedBaseLinkerOptions): boolean {
  return o.returnsSync && (o.demo || Boolean(o.apiToken))
}

/** Invoice numbers can be written: demo, or a token. */
export function canWriteInvoiceNumbers(o: ResolvedBaseLinkerOptions): boolean {
  return o.demo || Boolean(o.apiToken)
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
