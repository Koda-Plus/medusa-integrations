/**
 * THE ONLY HTTP CLIENT FOR BASELINKER. The connector URL below must not appear
 * anywhere else in the plugin, and that is a rule to check with grep at
 * review time, not good will: every call goes through `request()`, which asks
 * the write barrier BEFORE the rate limiter and BEFORE `fetch`, so a blocked
 * write does not even take a slot of the limit.
 *
 * THE CALL SHAPE IS BASELINKER'S CONTRACT: POST to connector.php, header
 * `X-BLToken`, form fields `method` and `parameters` (JSON in a string). The
 * answer is HTTP 200 also on failure; `errors.ts` reads the body.
 *
 * ERROR POLICY (ported from production)
 *   reads (get*)          network, timeout, 5xx, rate limit and temporary
 *                         BaseLinker errors: up to 3 attempts, pauses of
 *                         1 s and 4 s; permanent errors thrown at once
 *   addOrder              ONE shot. Only a rate limit refusal repeats
 *                         (BaseLinker took nothing). Every other transient
 *                         failure becomes `BaseLinkerUnknownResultError`,
 *                         answered by a marker scan, never by a blind retry
 *
 * `addOrder` is reachable only through `createOrderOnce()`, which scans for
 * the order marker first: a public raw `addOrder` would be one call away
 * from duplicated orders.
 *
 * The token comes in through the options, never leaves this object in clear
 * and is masked in every message.
 */

import type { Logger } from "@medusajs/framework/types"
import {
  parseCategories,
  parseExtraFields,
  parseInventories,
  parseManufacturers,
  parseOrderSources,
  parsePriceGroups,
  parseProductsData,
  parseProductsList,
  parseStatusList,
  parseWarehouses,
  readAllPages,
  entriesOf,
  type CardInput,
  type CatalogPage,
  type CatalogRead,
  type InventoryInfo,
  type OrderSourceInfo,
  type PriceGroupInfo,
  type ProductDetails,
  type WarehouseInfo,
} from "./catalog"
import { CATALOG_MAX_PAGES, CATALOG_PAGE_SIZE, DETAILS_BATCH, UNKNOWN_RESULT_RESCAN_MS } from "./constants"
import { BaseLinkerApiError, BaseLinkerUnknownResultError, interpretResponse, isRefused, isTransient } from "./errors"
import { createOrderOnce, findOrderByMarker, type CreateOnceResult } from "./exactly-once"
import { normalizeSku } from "./matching"
import type { AddOrderPayload } from "./order-payload"
import { BaseLinkerWriteBlockedError, isCallAllowed, isCreatingMethod, isReadMethod, maskSecrets } from "./security"
import { KIT_META } from "./kit-meta"

export const BASELINKER_API_URL = "https://api.baselinker.com/connector.php"

const USER_AGENT = `KodaPlus-BaseLinker-Plugin/${KIT_META.version} (+https://koda.plus)`

/** Warnings of a bulk update: product id to message. Only failed products are listed. */
export interface BulkResult {
  counter: number
  warnings: Record<string, string>
}

function warningMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const message = typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")
    if (key) out[key] = message.slice(0, 500)
  }
  return out
}

/** An order as `getOrders` returns it. Only the fields the plugin reads are named. */
export interface BaseLinkerOrder {
  order_id: number | string
  order_status_id?: number | string
  order_source?: string
  order_source_id?: number | string
  date_add?: number
  admin_comments?: string
  delivery_package_nr?: string
  delivery_package_module?: string
  payment_done?: number
  [key: string]: unknown
}

/* ------------------------------------------------------------------ */
/* Rate limiter: one per process, shared by every client instance      */
/* ------------------------------------------------------------------ */

/**
 * The BaseLinker limit (100 requests per minute) belongs to the TOKEN, not to
 * a job: the catalog read, the outbox and the status read share it. One
 * limiter per process, kept on `globalThis` so a module reload in develop
 * mode does not create a second one. A minimal spacing spreads the calls
 * instead of firing a burst and waiting 59 seconds.
 */
const WINDOW_MS = 60_000
const SPACING_MS = 120
const LIMITER_KEY = Symbol.for("koda.baselinker.limiter")

export interface Limiter {
  pass(): Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildLimiter(perMinute: number): Limiter {
  const stamps: number[] = []
  let last = 0
  let chain: Promise<void> = Promise.resolve()
  async function take(): Promise<void> {
    for (;;) {
      const now = Date.now()
      while (stamps.length > 0 && now - stamps[0] >= WINDOW_MS) stamps.shift()
      if (stamps.length >= perMinute) {
        await sleep(WINDOW_MS - (now - stamps[0]) + 10)
        continue
      }
      const sinceLast = now - last
      if (last > 0 && sinceLast < SPACING_MS) {
        await sleep(SPACING_MS - sinceLast)
        continue
      }
      last = Date.now()
      stamps.push(last)
      return
    }
  }
  return {
    pass(): Promise<void> {
      const next = chain.then(take)
      /* One failed pass must not break the chain for the next ones. */
      chain = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}

export function globalLimiter(perMinute: number): Limiter {
  const holder = globalThis as typeof globalThis & { [LIMITER_KEY]?: Limiter }
  if (!holder[LIMITER_KEY]) holder[LIMITER_KEY] = buildLimiter(Math.max(1, Math.floor(perMinute)))
  return holder[LIMITER_KEY] as Limiter
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface BaseLinkerClientOptions {
  token: string
  /** The barrier lets `addOrder` out only while this is on. */
  exportOrders: boolean
  requestsPerMinute: number
  timeoutMs: number
  logger?: Pick<Logger, "warn">
  /** Tests inject these; production uses the global ones. */
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** `null` turns the limiter off (tests). Default: the process-wide limiter. */
  limiter?: Limiter | null
  maxAttempts?: number
  /** Writers armed for this run (see `security.ts`). Empty by default: only reads and addOrder. */
  permits?: ReadonlySet<string>
}

export class BaseLinkerClient {
  private readonly o: BaseLinkerClientOptions
  private readonly limiter: Limiter | null
  private readonly doFetch: typeof fetch
  private readonly pause: (ms: number) => Promise<void>
  private readonly permits: ReadonlySet<string>

  constructor(options: BaseLinkerClientOptions) {
    this.o = options
    this.limiter = options.limiter === undefined ? globalLimiter(options.requestsPerMinute) : options.limiter
    this.doFetch = options.fetch ?? fetch
    this.pause = options.sleep ?? sleep
    this.permits = new Set(options.permits ?? [])
  }

  /**
   * The same client with one more writer permit. A job asks for it only after
   * it checked that the writer is armed; the barrier still decides per call.
   */
  forWriter(permit: string): BaseLinkerClient {
    return new BaseLinkerClient({ ...this.o, limiter: this.limiter, permits: new Set([...this.permits, permit]) })
  }

  /** Masks the token and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.o.token])
  }

  /* ---- Core: the only place anything leaves for the network -------- */

  private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const verdict = isCallAllowed({ method, exportOrders: this.o.exportOrders, permits: this.permits })
    if (!verdict.ok) throw new BaseLinkerWriteBlockedError(method, verdict.reason)
    if (!this.o.token.trim()) {
      throw new BaseLinkerApiError({ code: "NO_TOKEN", method, message: "apiToken is not set in the plugin options.", transient: false })
    }

    const creating = isCreatingMethod(method)
    const attempts = Math.max(1, this.o.maxAttempts ?? 3)
    let last: unknown = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (this.limiter) await this.limiter.pass()
      try {
        return await this.once(method, params)
      } catch (err) {
        last = err
        if (creating && !isRefused(err)) {
          /* A creating method after anything but a refusal: never repeated.
           * A permanent error means nothing was created and goes up as is; a
           * transient one means we do not know, and we say so. */
          throw isTransient(err) ? new BaseLinkerUnknownResultError(method, err) : err
        }
        if (!isTransient(err) || attempt === attempts) throw err
        const wait = attempt * attempt * 1000
        this.o.logger?.warn(`[baselinker] ${method}: attempt ${attempt} failed, retrying in ${wait} ms (${this.describe(err)})`)
        await this.pause(wait)
      }
    }
    throw last instanceof Error ? last : new BaseLinkerApiError({ code: "ERROR", method, message: "no answer", transient: true })
  }

  /** One HTTP call, no retries. */
  private async once(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response
    try {
      res = await this.doFetch(BASELINKER_API_URL, {
        method: "POST",
        headers: {
          "X-BLToken": this.o.token,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ method, parameters: JSON.stringify(params) }),
        /* Without a timeout a hanging answer would hold the outbox forever. */
        signal: AbortSignal.timeout(this.o.timeoutMs),
      })
    } catch (err) {
      throw new BaseLinkerApiError({ code: "ERROR_NETWORK", method, message: this.describe(err), transient: true })
    }
    const text = await res.text().catch(() => "")
    return interpretResponse({ method, httpStatus: res.status, text, mask: (t) => this.mask(t) })
  }

  private describe(err: unknown): string {
    const e = err as { name?: string; message?: string; cause?: { code?: string } } | null
    const raw = e && typeof e === "object" ? `${e.name ?? "Error"}: ${e.message ?? ""}${e.cause?.code ? ` (${e.cause.code})` : ""}` : String(err)
    return this.mask(raw)
  }

  /**
   * Any other READ of the BaseLinker API. Writes never go through here: each
   * one has its own method below, built so it can only write what its writer
   * is meant to write; `addOrder` only through `createOrderOnce`.
   */
  async call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (method.trim() === "addOrder") {
      throw new BaseLinkerWriteBlockedError("addOrder", "addOrder goes only through createOrderOnce(), which scans for the order marker first.")
    }
    if (!isReadMethod(method)) {
      const verdict = isCallAllowed({ method, exportOrders: this.o.exportOrders, permits: new Set() })
      throw new BaseLinkerWriteBlockedError(method, verdict.ok ? `${method} goes only through its own client method.` : verdict.reason)
    }
    return this.request(method, params)
  }

  /* ---- Reads --------------------------------------------------------- */

  async getInventories(): Promise<InventoryInfo[]> {
    const data = await this.request("getInventories", {})
    return parseInventories(data.inventories)
  }

  /** One page of cards, variants included (`include_variants`, since 0.2). */
  async getInventoryProductsList(inventoryId: number, page: number, warehouseId: string | null): Promise<CatalogPage> {
    const data = await this.request("getInventoryProductsList", { inventory_id: inventoryId, page, include_variants: true })
    return parseProductsList(data.products, warehouseId)
  }

  /**
   * Cards carrying one SKU, compared exactly on our side (the filter of
   * `getInventoryProductsList` is not documented as exact). Used before a card
   * is created, and again after an unclear answer.
   */
  async findCardsBySku(inventoryId: number, sku: string, warehouseId: string | null): Promise<CardInput[]> {
    const want = normalizeSku(sku)
    if (!want) return []
    const data = await this.request("getInventoryProductsList", { inventory_id: inventoryId, filter_sku: sku, include_variants: true })
    return parseProductsList(data.products, warehouseId).cards.filter((c) => normalizeSku(c.sku) === want)
  }

  /** Details of main products, 100 ids per call. One failed batch fails the whole read: details are all or nothing. */
  async getInventoryProductsData(inventoryId: number, ids: readonly string[]): Promise<ProductDetails[]> {
    const out: ProductDetails[] = []
    for (let i = 0; i < ids.length; i += DETAILS_BATCH) {
      const part = ids.slice(i, i + DETAILS_BATCH).map((id) => Number(id))
      const data = await this.request("getInventoryProductsData", { inventory_id: inventoryId, products: part })
      out.push(...parseProductsData(data.products))
    }
    return out
  }

  async getInventoryPriceGroups(): Promise<PriceGroupInfo[]> {
    const data = await this.request("getInventoryPriceGroups", {})
    return parsePriceGroups(data.price_groups)
  }

  async getInventoryWarehouses(): Promise<WarehouseInfo[]> {
    const data = await this.request("getInventoryWarehouses", {})
    return parseWarehouses(data.warehouses)
  }

  async getInventoryCategories(inventoryId: number): Promise<Map<number, { name: string; parentId: number | null }>> {
    const data = await this.request("getInventoryCategories", { inventory_id: inventoryId })
    return parseCategories(data.categories)
  }

  /** Every manufacturer, 1000 per page, at most 20 pages. */
  async getInventoryManufacturers(): Promise<Map<number, string>> {
    const out = new Map<number, string>()
    for (let page = 1; page <= 20; page += 1) {
      const data = await this.request("getInventoryManufacturers", { page })
      const list = parseManufacturers(data.manufacturers)
      for (const [id, name] of list) out.set(id, name)
      if (entriesOf(data.manufacturers).length < 1000) break
    }
    return out
  }

  async getOrderSources(): Promise<OrderSourceInfo[]> {
    const data = await this.request("getOrderSources", {})
    return parseOrderSources(data.sources)
  }

  async getOrderExtraFields(): Promise<Array<{ id: number; name: string; type: string }>> {
    const data = await this.request("getOrderExtraFields", {})
    return parseExtraFields(data.extra_fields)
  }

  /** Raw journal entries; `lib/journal.ts` reads them. */
  async getJournalList(params: { last_log_id?: number; logs_types?: readonly number[]; order_id?: number }): Promise<unknown[]> {
    const data = await this.request("getJournalList", params as Record<string, unknown>)
    return Array.isArray(data.logs) ? data.logs : entriesOf(data.logs).map(([, v]) => v)
  }

  /** Raw returns (100 per call); `lib/returns.ts` drops the personal data before anything is stored. */
  async getOrderReturns(params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const data = await this.request("getOrderReturns", params)
    return entriesOf(data.returns).map(([, r]) => r)
  }

  async getOrderReturnStatusList(): Promise<Map<number, string>> {
    const data = await this.request("getOrderReturnStatusList", {})
    return parseStatusList(data.statuses)
  }

  async getOrderReturnReasonsList(): Promise<Map<number, string>> {
    const data = await this.request("getOrderReturnReasonsList", {})
    const out = new Map<number, string>()
    for (const [, r] of entriesOf(data.return_reasons)) {
      const id = Number(r.return_reason_id)
      if (Number.isFinite(id) && id > 0 && typeof r.name === "string") out.set(id, r.name)
    }
    return out
  }

  /* ---- Writes behind a writer permit -------------------------------- */

  /**
   * `addInventoryProduct`: a new card without `product_id`, an update with it.
   * A create is one shot (the client never repeats a creating method), so the
   * caller looks the SKU up before and after an unclear answer.
   */
  async addInventoryProduct(params: Record<string, unknown>): Promise<{ productId: string; warnings: Record<string, string> }> {
    const data = await this.request("addInventoryProduct", params)
    const id = String(data.product_id ?? "").trim()
    if (!id || id === "0") {
      throw new BaseLinkerUnknownResultError("addInventoryProduct", new Error("success answer without product_id"))
    }
    return { productId: id, warnings: warningMap((data.warnings as Record<string, unknown> | undefined)?.parameters ?? data.warnings) }
  }

  /**
   * A NEW CARD AT MOST ONCE. `addInventoryProduct` without an id has no
   * idempotency key, so: look the SKU up first (one card: adopt it, write
   * nothing; several: refuse), then one create; after an unclear answer wait,
   * look again, and adopt what is there instead of creating a second card.
   */
  async createCardOnce(
    inventoryId: number,
    params: Record<string, unknown>,
    sku: string,
    warehouseId: string | null,
  ): Promise<{ productId: string; adopted: boolean }> {
    const before = await this.findCardsBySku(inventoryId, sku, warehouseId)
    if (before.length > 1) {
      throw new BaseLinkerApiError({
        code: "DUPLICATE_SKU",
        method: "addInventoryProduct",
        message: `SKU ${sku} is already on ${before.length} cards; nothing was created.`,
        transient: false,
      })
    }
    if (before.length === 1) return { productId: before[0].blProductId, adopted: true }
    try {
      const { productId } = await this.addInventoryProduct(params)
      return { productId, adopted: false }
    } catch (err) {
      if (!(err instanceof BaseLinkerUnknownResultError)) throw err
      await this.pause(UNKNOWN_RESULT_RESCAN_MS)
      let after: CardInput[] = []
      try {
        after = await this.findCardsBySku(inventoryId, sku, warehouseId)
      } catch {
        /* still unknown: the next run looks first */
      }
      if (after.length === 1) return { productId: after[0].blProductId, adopted: true }
      throw err
    }
  }

  /** Absolute stock per card and warehouse, at most 1000 cards per call. */
  async updateInventoryProductsStock(inventoryId: number, products: Record<string, Record<string, number>>): Promise<BulkResult> {
    const data = await this.request("updateInventoryProductsStock", { inventory_id: inventoryId, products })
    return { counter: Number(data.counter) || 0, warnings: warningMap(data.warnings) }
  }

  /** Gross prices per card and price group, at most 1000 cards per call. */
  async updateInventoryProductsPrices(inventoryId: number, products: Record<string, Record<string, number>>): Promise<BulkResult> {
    const data = await this.request("updateInventoryProductsPrices", { inventory_id: inventoryId, products })
    return { counter: Number(data.counter) || 0, warnings: warningMap(data.warnings) }
  }

  /**
   * One order field and nothing else: `extra_field_1`, `extra_field_2` or a
   * custom extra field (`custom:<id>`). This is the only `setOrderFields` call
   * the plugin makes.
   */
  async setOrderField(orderId: number, field: string, value: string): Promise<void> {
    const params: Record<string, unknown> = { order_id: orderId }
    if (field === "extra_field_1" || field === "extra_field_2") params[field] = value.slice(0, 50)
    else {
      const m = /^custom:(\d+)$/.exec(field)
      if (!m) throw new BaseLinkerWriteBlockedError("setOrderFields", `Unknown order field ${field}.`)
      params.custom_extra_fields = { [m[1]]: value }
    }
    await this.request("setOrderFields", params)
  }

  /** Every card of the catalog, page after page. An incomplete read is a flag, not an exception. */
  readCatalog(inventoryId: number, warehouseId: string | null, maxPages: number = CATALOG_MAX_PAGES): Promise<CatalogRead> {
    return readAllPages((page) => this.getInventoryProductsList(inventoryId, page, warehouseId), {
      pageSize: CATALOG_PAGE_SIZE,
      maxPages,
    })
  }

  async getOrders(params: Record<string, unknown>): Promise<BaseLinkerOrder[]> {
    const data = await this.request("getOrders", params)
    return entriesOf(data.orders).map(([, o]) => o as BaseLinkerOrder)
  }

  async getOrderStatusList(): Promise<Map<number, string>> {
    const data = await this.request("getOrderStatusList", {})
    return parseStatusList(data.statuses)
  }

  /* ---- The one write ------------------------------------------------- */

  /** Scans for the marker, then at most one `addOrder`. See `exactly-once.ts`. */
  createOrderOnce(payload: AddOrderPayload, marker: string, placedAtUnix: number): Promise<CreateOnceResult> {
    return createOrderOnce({
      findExisting: () => findOrderByMarker((params) => this.getOrders(params), marker, placedAtUnix),
      addOrder: async () => {
        const data = await this.request("addOrder", payload as unknown as Record<string, unknown>)
        return String(data.order_id ?? "")
      },
      sleep: this.pause,
    })
  }
}
