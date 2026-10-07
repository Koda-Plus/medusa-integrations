/**
 * THE STRIPE CLIENT: GET ONLY. No runtime imports beyond the pure helpers.
 *
 * READ ONLY BY CONSTRUCTION. The client has one way to talk to Stripe, a GET
 * to https://api.stripe.com/v1, on a path checked against a short pattern.
 * There is no method that could create a charge, a refund or a payout, so a
 * bug in this plugin cannot move money. Captures and refunds stay in
 * Medusa's order actions, done by the official provider.
 *
 * Plain `fetch`, no Stripe SDK: the plugin needs a dozen list and retrieve
 * calls. Parameters use Stripe's form encoding (`created[gte]=...`,
 * `expand[0]=...`), the API version is pinned, requests keep to the plugin's
 * own rate limit, and a 429, a 5xx or a dropped connection is retried twice
 * with backoff (Retry-After and Stripe-Should-Retry are honoured).
 */
import { DEFAULT_REQUESTS_PER_SECOND, DEFAULT_TIMEOUT_MS, LIST_LIMIT, MAX_CONCURRENCY, MAX_RETRIES, MAX_RETRY_WAIT_MS, STRIPE_API_BASE, STRIPE_API_VERSION } from "./constants"
import { kindOfStatus, StripeApiError } from "./errors"
import { KIT_META } from "./kit-meta"
import { backoffMs, realClock, retryAfterMs, Semaphore, TokenBucket, type Clock } from "./rate-limit"
import { canRead, keyInfo } from "./security"
import type { RawList } from "./stripe-types"

export type StripeParamValue = string | number | boolean | null | undefined | StripeParamValue[] | { [key: string]: StripeParamValue }
export type StripeParams = Record<string, StripeParamValue>

/**
 * Stripe's form encoding for query strings: nested objects as `a[b]=`,
 * arrays with indices as `a[0]=` (what stripe-node sends), booleans as
 * words, null and undefined left out. Brackets stay literal, values are
 * percent-encoded.
 */
export function encodeParams(params: StripeParams | undefined): string {
  const parts: string[] = []
  const walk = (key: string, value: StripeParamValue): void => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v))
      return
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(`${key}[${k}]`, v)
      return
    }
    const encodedKey = encodeURIComponent(key).replace(/%5B/gi, "[").replace(/%5D/gi, "]")
    parts.push(`${encodedKey}=${encodeURIComponent(String(value))}`)
  }
  for (const [k, v] of Object.entries(params ?? {})) walk(k, v)
  return parts.join("&")
}

/** API paths the client accepts: `/balance`, `/payment_intents`, `/payment_intents/pi_123`. */
const PATH = /^\/[a-z_]+(\/[A-Za-z0-9_]+)?$/

export interface FetchResponseLike {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponseLike>

export interface StripeClientOptions {
  apiKey: string
  requestsPerSecond?: number
  timeoutMs?: number
  apiVersion?: string
  fetch?: FetchLike
  clock?: Clock
  random?: () => number
  maxRetries?: number
  userAgent?: string
}

/** Per call: past `deadline` (ms on the client's clock) no retry and no further page is asked for. */
export interface ReadOptions {
  deadline?: number | null
}

export interface ListResult<T> {
  data: T[]
  /** False when the read stopped at `maxPages` with more on Stripe's side. */
  complete: boolean
  pages: number
}

export class StripeReadClient {
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly apiVersion: string
  private readonly fetchImpl: FetchLike
  private readonly clock: Clock
  private readonly random: () => number
  private readonly maxRetries: number
  private readonly userAgent: string
  private readonly bucket: TokenBucket
  private readonly gate = new Semaphore(MAX_CONCURRENCY)
  /** Requests sent, for the tests and the logs. */
  requests = 0

  constructor(options: StripeClientOptions) {
    this.apiKey = String(options.apiKey ?? "").trim()
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.apiVersion = options.apiVersion ?? STRIPE_API_VERSION
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.clock = options.clock ?? realClock
    this.random = options.random ?? Math.random
    this.maxRetries = options.maxRetries ?? MAX_RETRIES
    this.userAgent = options.userAgent ?? `KodaPlus-MedusaPluginStripe/${KIT_META.version} (+https://koda.plus)`
    this.bucket = new TokenBucket(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND, this.clock)
  }

  private secrets(): string[] {
    return [this.apiKey]
  }

  private async send(url: string): Promise<FetchResponseLike> {
    const controller = typeof AbortController === "function" ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null
    try {
      this.requests += 1
      return await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Stripe-Version": this.apiVersion,
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: controller?.signal,
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private late(options?: ReadOptions): boolean {
    return typeof options?.deadline === "number" && this.clock.now() >= options.deadline
  }

  /** One GET. Throws a StripeApiError with a masked message. Past the deadline it does not retry. */
  async get<T>(path: string, params?: StripeParams, options?: ReadOptions): Promise<T> {
    if (!PATH.test(path)) throw new StripeApiError({ kind: "invalid", message: `Refused path ${path}: the plugin reads fixed Stripe resources only.` })
    if (!canRead(keyInfo(this.apiKey)) && keyInfo(this.apiKey).kind !== "unknown") {
      throw new StripeApiError({
        kind: "auth",
        message: this.apiKey ? "A publishable key (pk_) cannot read from Stripe: use a restricted key (rk_) with read permissions." : "No Stripe API key: set the apiKey option.",
        secrets: this.secrets(),
      })
    }
    const query = encodeParams(params)
    const url = `${STRIPE_API_BASE}${path}${query ? `?${query}` : ""}`

    for (let attempt = 0; ; attempt++) {
      await this.bucket.take()
      let res: FetchResponseLike
      try {
        res = await this.gate.run(() => this.send(url))
      } catch (err) {
        if (attempt < this.maxRetries && !this.late(options)) {
          await this.clock.sleep(backoffMs(attempt, this.random))
          continue
        }
        const aborted = err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message))
        throw new StripeApiError({
          kind: "network",
          message: aborted ? `Stripe did not answer within ${Math.round(this.timeoutMs / 1000)} s.` : `No connection to Stripe: ${err instanceof Error ? err.message : String(err)}`,
          secrets: this.secrets(),
        })
      }

      const text = await res.text().catch(() => "")
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      if (res.status >= 200 && res.status < 300) {
        if (!json || typeof json !== "object") {
          throw new StripeApiError({ kind: "stripe", message: `Stripe sent an answer that is not JSON (HTTP ${res.status}).`, status: res.status })
        }
        return json as T
      }

      const shouldRetry = (res.headers.get("stripe-should-retry") ?? "").toLowerCase()
      const retryable = shouldRetry === "true" || ((res.status === 429 || res.status >= 500) && shouldRetry !== "false")
      if (retryable && attempt < this.maxRetries && !this.late(options)) {
        const wait = retryAfterMs(res.headers.get("retry-after"), this.clock.now()) ?? backoffMs(attempt, this.random)
        await this.clock.sleep(Math.min(wait, MAX_RETRY_WAIT_MS))
        continue
      }
      const error = (json as { error?: { message?: string; code?: string; type?: string } } | null)?.error
      throw new StripeApiError({
        kind: kindOfStatus(res.status),
        message: error?.message ?? `Stripe answered HTTP ${res.status}.`,
        status: res.status,
        code: error?.code ?? error?.type ?? null,
        requestId: res.headers.get("request-id"),
        secrets: this.secrets(),
      })
    }
  }

  /**
   * A list, page after page with `starting_after`, up to `maxPages` pages of
   * `limit` objects. Stops early when Stripe says there is nothing more, and
   * past the deadline (then `complete` is false: the oldest objects are missing).
   */
  async list<T extends { id?: string }>(path: string, params: StripeParams, options: { maxPages: number; limit?: number } & ReadOptions): Promise<ListResult<T>> {
    const out: T[] = []
    let startingAfter: string | undefined
    const maxPages = Math.max(1, Math.floor(options.maxPages))
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1 && this.late(options)) return { data: out, complete: false, pages: page - 1 }
      const res = await this.get<RawList<T>>(path, { ...params, limit: options.limit ?? LIST_LIMIT, starting_after: startingAfter }, options)
      const data = Array.isArray(res?.data) ? res.data : []
      out.push(...data)
      if (!res?.has_more || data.length === 0) return { data: out, complete: true, pages: page }
      const last = data[data.length - 1]?.id
      if (typeof last !== "string" || !last) return { data: out, complete: false, pages: page }
      startingAfter = last
    }
    return { data: out, complete: false, pages: maxPages }
  }
}
