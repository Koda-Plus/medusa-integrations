/**
 * THE ONLY HTTP CLIENT FOR THE CENEO API. Ceneo URLs of the seller API must
 * not appear anywhere else in the plugin. No runtime dependency: `fetch`
 * (injectable for the tests) and `node:crypto` for the token cache key.
 *
 * TOKEN: `GET /AuthorizationService.svc/GetToken` with `Authorization:
 * Basic <API key>` gives a Bearer token valid 900 s. One cache per process
 * and per key, refreshed 60 s early, one request at a time (single flight).
 * A 401 on a call drops the token and retries once with a new one.
 *
 * THE BARRIER. Every Ceneo method is a GET, the writes too (ConfirmOrder,
 * SendOrder, CancelOrder...), so the method says nothing: the barrier is a
 * whitelist of read paths plus the write paths of each writer. A write path
 * passes only through `write()` and only for a writer the client was built
 * with (`writers`, the effective ones: both switches on). Anything else
 * throws before the network.
 *
 * ERRORS: network, timeout and 5xx: 3 attempts (pauses 1 s, 4 s). 429: one
 * wait (Retry-After, at most 2 minutes, otherwise 30 s). Other 4xx: thrown
 * at once. The API key and the token are masked in every message.
 */

import { createHash } from "node:crypto"
import { parseToken } from "./odata"

export const CENEO_API_BASE = "https://developers.ceneo.pl"
const TOKEN_PATH = "/AuthorizationService.svc/GetToken"
const TOKEN_TTL_MS = 900_000
const TOKEN_MARGIN_MS = 60_000

export class CeneoApiError extends Error {
  readonly status: number
  readonly transient: boolean

  constructor(status: number, message: string, transient: boolean) {
    super(message)
    this.name = "CeneoApiError"
    this.status = status
    this.transient = transient
  }
}

export class CeneoBlockedError extends Error {
  constructor(path: string) {
    super(`The Ceneo client refuses ${path}: not a read method, and no armed writer covers it.`)
    this.name = "CeneoBlockedError"
  }
}

const ORDER_SUB = "(?:OrderItems|ShippingData|InvoiceData|PickupPoint|PaymentMethods|PaymentTypes|OrderStates|OrderAdditionalServices)"
const READ_PATHS: RegExp[] = [
  /^\/AuthorizationService\.svc\/GetToken$/,
  /^\/BasketService\.svc\/Orders$/,
  new RegExp(`^/BasketService\\.svc/Orders\\(guid'[0-9a-fA-F-]{36}'\\)(?:/${ORDER_SUB})?$`),
  /^\/BasketService\.svc\/(?:OrderStates|PaymentMethods|PaymentTypes|ParcelCarriers|OrderCancellationReasons|OrderEditionReasons|OrderReturnReasons)$/,
  /^\/api\/v2\/function\/webapi_meta\.GetExecutionLimits\/Call$/,
  /^\/api\/v2\/function\/bidding\.(?:GetProductsBidsByShopProductId|GetProductsBidsByCeneoProductId|GetCategoryBidByCategoryId)\/Call$/,
  /^\/api\/v2\/function\/webapi_data_critical\.(?:shop_getProductTop10OffersBy_IDs|shop_getProductOffersBy_IDs)\/Call$/,
  /^\/api\/v3\/GetTopCategoryProducts$/,
]

export function isReadPath(path: string): boolean {
  return READ_PATHS.some((r) => r.test(path))
}

/** The write paths, each with the writer that may call it. */
export const WRITE_PATHS: Readonly<Record<string, "status" | "bids" | "promo">> = {
  "/BasketService.svc/SetOrders": "status",
  "/BasketService.svc/ConfirmOrder": "status",
  "/BasketService.svc/SetOrderShipment": "status",
  "/BasketService.svc/SendOrder": "status",
  "/BasketService.svc/CancelOrder": "status",
  "/api/v2/function/bidding.SetProductsBids/Call": "bids",
  "/api/v2/function/bidding.SetCategoryBids/Call": "bids",
  "/api/v3/SetPromotionTextForProducts": "promo",
  "/api/v3/SetPromotionTextForCategories": "promo",
  "/api/v3/RemovePromotionTextsForProducts": "promo",
  "/api/v3/RemovePromotionTextsForCategories": "promo",
}

export function writerOfPath(path: string): string | null {
  return Object.prototype.hasOwnProperty.call(WRITE_PATHS, path) ? WRITE_PATHS[path] : null
}

/** A string parameter of an OData service operation: in single quotes, a quote doubled. */
export function odataString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (!s || s.length < 6) continue
    /* As written, as encodeURIComponent and as URLSearchParams write it (a URL echoed in an error). */
    const forms = new Set([s, encodeURIComponent(s), new URLSearchParams({ k: s }).toString().slice(2)])
    for (const f of forms) out = out.split(f).join(`${s.slice(0, 3)}***`)
  }
  return out
}

export function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(120_000, Math.max(1_000, Math.round(seconds * 1000)))
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

export interface CeneoClientOptions {
  apiKey: string
  timeoutMs: number
  logger?: { warn(msg: string): void }
  /** The writers that may write through this client (the effective ones). Default: none. */
  writers?: readonly string[]
  baseUrl?: string
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

type CachedToken = { token: string; expiresAt: number }
type TokenHolder = typeof globalThis & { [k: symbol]: Map<string, CachedToken> | Map<string, Promise<string>> | undefined }
const TOKENS = Symbol.for("koda.ceneo.tokens")
const PENDING = Symbol.for("koda.ceneo.tokens.pending")

function store<T>(key: symbol): Map<string, T> {
  const h = globalThis as TokenHolder
  if (!h[key]) h[key] = new Map()
  return h[key] as unknown as Map<string, T>
}

/** Drops every cached token (tests, and a changed key in a running process). */
export function resetCeneoTokens(): void {
  store<CachedToken>(TOKENS).clear()
  store<Promise<string>>(PENDING).clear()
}

export class CeneoClient {
  private readonly o: Required<Omit<CeneoClientOptions, "logger">> & { logger?: CeneoClientOptions["logger"] }
  private readonly keyId: string

  constructor(options: CeneoClientOptions) {
    this.o = {
      baseUrl: CENEO_API_BASE,
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      writers: [],
      ...options,
    }
    this.keyId = createHash("sha256").update(options.apiKey).digest("hex").slice(0, 16)
  }

  private mask(text: string, token?: string | null): string {
    return maskSecrets(text, [this.o.apiKey, token])
  }

  /** The Bearer token, from the cache or from Ceneo; one request at a time per key. */
  async token(force = false): Promise<string> {
    const cache = store<CachedToken>(TOKENS)
    const pending = store<Promise<string>>(PENDING)
    const hit = cache.get(this.keyId)
    if (!force && hit && hit.expiresAt - TOKEN_MARGIN_MS > this.o.now()) return hit.token
    const inflight = pending.get(this.keyId)
    if (inflight) return inflight
    const p = (async () => {
      const text = await this.raw(`${TOKEN_PATH}?grantType='client_credentials'`, TOKEN_PATH, { Authorization: `Basic ${this.o.apiKey}` }, null)
      const token = parseToken(text)
      if (!token) throw new CeneoApiError(200, "Ceneo GetToken answered without a token.", false)
      cache.set(this.keyId, { token, expiresAt: this.o.now() + TOKEN_TTL_MS })
      return token
    })()
    pending.set(this.keyId, p)
    try {
      return await p
    } finally {
      pending.delete(this.keyId)
    }
  }

  /** A read with the Bearer token; JSON body. */
  async get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const qs = new URLSearchParams({ ...query, $format: "json" })
    let token = await this.token()
    try {
      return this.json(await this.raw(`${path}?${qs.toString()}`, path, { Authorization: `Bearer ${token}` }, token), path, token)
    } catch (err) {
      if (!(err instanceof CeneoApiError) || err.status !== 401) throw err
      token = await this.token(true)
      return this.json(await this.raw(`${path}?${qs.toString()}`, path, { Authorization: `Bearer ${token}` }, token), path, token)
    }
  }

  /**
   * A write: a GET on a write path, for a writer this client was built with.
   * Writes are NOT retried on a network error or a 5xx (Ceneo may have
   * applied it); the caller records the failure and the next run tries again.
   */
  async write(path: string, query: Record<string, string>, writer: string): Promise<unknown> {
    if (writerOfPath(path) !== writer || !this.o.writers.includes(writer)) throw new CeneoBlockedError(path)
    const qs = new URLSearchParams({ ...query, $format: "json" })
    let token = await this.token()
    try {
      return this.json(await this.raw(`${path}?${qs.toString()}`, path, { Authorization: `Bearer ${token}` }, token, writer), path, token)
    } catch (err) {
      if (!(err instanceof CeneoApiError) || err.status !== 401) throw err
      token = await this.token(true)
      return this.json(await this.raw(`${path}?${qs.toString()}`, path, { Authorization: `Bearer ${token}` }, token, writer), path, token)
    }
  }

  /** `GetExecutionLimits`: a "function" method, the key as a parameter instead of a token. */
  async limits(): Promise<unknown> {
    return this.fn("/api/v2/function/webapi_meta.GetExecutionLimits/Call", {})
  }

  /** A read of the "function" API (`/api/v2/function/...`): `apiKey` and `resultFormatter=json` as parameters, no token. */
  async fn(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams({ ...params, apiKey: this.o.apiKey, resultFormatter: "json" })
    return this.json(await this.raw(`${path}?${qs.toString()}`, path, {}, null), path, null)
  }

  /** A write of the "function" API, for a writer this client was built with; sent once. */
  async fnWrite(path: string, params: Record<string, string>, writer: string): Promise<unknown> {
    if (writerOfPath(path) !== writer || !this.o.writers.includes(writer)) throw new CeneoBlockedError(path)
    const qs = new URLSearchParams({ ...params, apiKey: this.o.apiKey, resultFormatter: "json" })
    return this.json(await this.raw(`${path}?${qs.toString()}`, path, {}, null, writer), path, null)
  }

  private json(text: string, path: string, token: string | null): unknown {
    if (!text.trim()) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new CeneoApiError(200, this.mask(`Ceneo ${path}: the answer is not JSON: ${text.slice(0, 160)}`, token), false)
    }
  }

  private async raw(pathAndQuery: string, path: string, headers: Record<string, string>, token: string | null, writer: string | null = null): Promise<string> {
    const allowed = writer === null ? isReadPath(path) : writerOfPath(path) === writer && this.o.writers.includes(writer)
    if (!allowed) throw new CeneoBlockedError(path)
    const url = `${this.o.baseUrl}${pathAndQuery}`
    /* A write is sent once (a 429 still waits once: Ceneo refused it, nothing was applied). */
    const PAUSES = writer === null ? [0, 1000, 4000] : [0]
    let last: unknown = null
    let waited = false
    for (let attempt = 0; attempt < PAUSES.length; attempt += 1) {
      if (PAUSES[attempt] > 0) await this.o.sleep(PAUSES[attempt])
      try {
        const res = await this.o.fetch(url, { method: "GET", headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(this.o.timeoutMs) })
        const text = await res.text()
        if (res.ok) return text
        const body = this.mask(text.slice(0, 240), token)
        if (res.status === 429 && !waited) {
          waited = true
          const wait = retryAfterMs(res.headers.get("retry-after")) ?? 30_000
          this.o.logger?.warn(`[ceneo] 429 on ${path}, waiting ${Math.round(wait / 1000)} s.`)
          await this.o.sleep(wait)
          attempt -= 1
          continue
        }
        const err = new CeneoApiError(res.status, `Ceneo ${res.status} on ${path}: ${body}`, res.status >= 500)
        if (!err.transient) throw err
        last = err
      } catch (err) {
        if (err instanceof CeneoApiError) {
          if (!err.transient) throw err
          last = err
          continue
        }
        last = new CeneoApiError(0, this.mask(`Ceneo ${path}: ${String(err)}`, token), true)
      }
    }
    throw last instanceof Error ? last : new CeneoApiError(0, `Ceneo ${path}: unknown error`, true)
  }
}
