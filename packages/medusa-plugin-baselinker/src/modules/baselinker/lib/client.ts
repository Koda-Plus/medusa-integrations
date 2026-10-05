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
  parseInventories,
  parseProductsList,
  parseStatusList,
  readAllPages,
  entriesOf,
  type CatalogPage,
  type CatalogRead,
  type InventoryInfo,
} from "./catalog"
import { CATALOG_MAX_PAGES, CATALOG_PAGE_SIZE } from "./constants"
import { BaseLinkerApiError, BaseLinkerUnknownResultError, interpretResponse, isRefused, isTransient } from "./errors"
import { createOrderOnce, findOrderByMarker, type CreateOnceResult } from "./exactly-once"
import type { AddOrderPayload } from "./order-payload"
import { BaseLinkerWriteBlockedError, isCallAllowed, isCreatingMethod, maskSecrets } from "./security"

export const BASELINKER_API_URL = "https://api.baselinker.com/connector.php"

const USER_AGENT = "KodaPlus-Medusa-BaseLinker/0.1 (+https://koda.plus)"

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
}

export class BaseLinkerClient {
  private readonly o: BaseLinkerClientOptions
  private readonly limiter: Limiter | null
  private readonly doFetch: typeof fetch
  private readonly pause: (ms: number) => Promise<void>

  constructor(options: BaseLinkerClientOptions) {
    this.o = options
    this.limiter = options.limiter === undefined ? globalLimiter(options.requestsPerMinute) : options.limiter
    this.doFetch = options.fetch ?? fetch
    this.pause = options.sleep ?? sleep
  }

  /** Masks the token and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.o.token])
  }

  /* ---- Core: the only place anything leaves for the network -------- */

  private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const verdict = isCallAllowed({ method, exportOrders: this.o.exportOrders })
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
   * Any other READ of the BaseLinker API (for example `getOrderSources`).
   * Writes stay behind the barrier; `addOrder` only through `createOrderOnce`.
   */
  async call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (method.trim() === "addOrder") {
      throw new BaseLinkerWriteBlockedError("addOrder", "addOrder goes only through createOrderOnce(), which scans for the order marker first.")
    }
    return this.request(method, params)
  }

  /* ---- Reads --------------------------------------------------------- */

  async getInventories(): Promise<InventoryInfo[]> {
    const data = await this.request("getInventories", {})
    return parseInventories(data.inventories)
  }

  async getInventoryProductsList(inventoryId: number, page: number, warehouseId: string | null): Promise<CatalogPage> {
    const data = await this.request("getInventoryProductsList", { inventory_id: inventoryId, page })
    return parseProductsList(data.products, warehouseId)
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
