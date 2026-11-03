/**
 * THE RAILWAY CLIENT: QUERIES ONLY. No runtime imports beyond the pure helpers.
 *
 * Railway's public API is one GraphQL endpoint, and a project token can do
 * everything the project's members can (redeploy, delete, change variables).
 * Railway offers no read-only token, so this client is read only by
 * construction: it has one method, `query`, and every document passes
 * `assertReadOnlyDocument` (no "mutation", no "subscription", a query or a
 * selection set) before anything is sent. The documents themselves are fixed
 * strings in `queries.ts`; ids travel as GraphQL variables, never pasted in.
 *
 * Plain `fetch`, POST with a JSON body (that is how GraphQL is sent; the
 * verb says nothing about writing). The plugin's own brakes apply: a token
 * bucket per second, a budget per hour, two requests in flight, one retry
 * after a 429, a 5xx or a dropped connection.
 */
import { DEFAULT_REQUESTS_PER_HOUR, DEFAULT_REQUESTS_PER_SECOND, DEFAULT_TIMEOUT_MS, MAX_RETRIES, MAX_RETRY_WAIT_MS, RAILWAY_API_URL } from "./constants"
import type { RateLimitDto, TokenKind } from "./contract"
import { kindOfGraphqlMessage, kindOfStatus, RailwayApiError } from "./errors"
import { KIT_META } from "./kit-meta"
import { backoffMs, HourlyBudget, realClock, retryAfterMs, Semaphore, TokenBucket, type Clock } from "./rate-limit"
import { assertReadOnlyDocument, ForbiddenDocumentError } from "./security"

export interface FetchResponseLike {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type FetchLike = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<FetchResponseLike>

export interface RailwayClientOptions {
  token: string
  requestsPerSecond?: number
  requestsPerHour?: number
  timeoutMs?: number
  fetch?: FetchLike
  clock?: Clock
  random?: () => number
  maxRetries?: number
  userAgent?: string
  url?: string
}

/** The two ways a Railway token authenticates. */
export function authHeaders(token: string, kind: TokenKind): Record<string, string> {
  return kind === "project" ? { "Project-Access-Token": token } : { Authorization: `Bearer ${token}` }
}

export class RailwayReadClient {
  private readonly token: string
  private readonly timeoutMs: number
  private readonly fetchImpl: FetchLike
  private readonly clock: Clock
  private readonly random: () => number
  private readonly maxRetries: number
  private readonly userAgent: string
  private readonly url: string
  private readonly bucket: TokenBucket
  private readonly gate = new Semaphore(2)
  readonly budget: HourlyBudget
  /** Requests sent, for the tests and the logs. */
  requests = 0
  /** Railway's counter from the last answer that carried one. */
  rateLimit: RateLimitDto | null = null

  constructor(options: RailwayClientOptions) {
    this.token = String(options.token ?? "").trim()
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.clock = options.clock ?? realClock
    this.random = options.random ?? Math.random
    this.maxRetries = options.maxRetries ?? MAX_RETRIES
    this.userAgent = options.userAgent ?? `KodaPlus-MedusaPluginRailway/${KIT_META.version} (+https://koda.plus)`
    this.url = options.url ?? RAILWAY_API_URL
    this.bucket = new TokenBucket(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND, this.clock)
    this.budget = new HourlyBudget(options.requestsPerHour ?? DEFAULT_REQUESTS_PER_HOUR, this.clock)
  }

  private secrets(): string[] {
    return [this.token]
  }

  private noteRateLimit(headers: FetchResponseLike["headers"]): void {
    const num = (name: string) => {
      const v = Number(headers.get(name))
      return headers.get(name) !== null && Number.isFinite(v) ? v : null
    }
    const limit = num("x-ratelimit-limit")
    const remaining = num("x-ratelimit-remaining")
    const reset = headers.get("x-ratelimit-reset")
    if (limit === null && remaining === null) return
    let resetAt: string | null = null
    if (reset) {
      const n = Number(reset)
      /* Seconds since the epoch, or seconds from now when small. */
      const ms = Number.isFinite(n) ? (n > 1e9 ? n * 1000 : this.clock.now() + n * 1000) : Date.parse(reset)
      resetAt = Number.isFinite(ms) ? new Date(ms).toISOString() : null
    }
    this.rateLimit = { limit, remaining, resetAt }
  }

  private async send(body: string, kind: TokenKind): Promise<FetchResponseLike> {
    const controller = typeof AbortController === "function" ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null
    try {
      this.requests += 1
      return await this.fetchImpl(this.url, {
        method: "POST",
        headers: { ...authHeaders(this.token, kind), "Content-Type": "application/json", Accept: "application/json", "User-Agent": this.userAgent },
        body,
        signal: controller?.signal,
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * One query. Throws a RailwayApiError with a masked message. A document
   * the guard refuses never leaves the process (kind "forbidden").
   */
  async query<T>(document: string, variables: Record<string, unknown>, kind: TokenKind): Promise<T> {
    try {
      assertReadOnlyDocument(document)
    } catch (err) {
      throw new RailwayApiError({ kind: "forbidden", message: err instanceof ForbiddenDocumentError ? err.message : String(err) })
    }
    if (!this.token) throw new RailwayApiError({ kind: "auth", message: "No Railway token: set the token option or the RAILWAY_READ_TOKEN variable." })
    const body = JSON.stringify({ query: document, variables })

    for (let attempt = 0; ; attempt++) {
      if (!this.budget.take()) {
        throw new RailwayApiError({ kind: "rate_limited", message: `The plugin's own budget of ${this.budget.limit} Railway requests an hour is spent (option requestsPerHour).` })
      }
      await this.bucket.take()
      let res: FetchResponseLike
      try {
        res = await this.gate.run(() => this.send(body, kind))
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.clock.sleep(backoffMs(attempt, this.random))
          continue
        }
        const aborted = err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message))
        throw new RailwayApiError({
          kind: "network",
          message: aborted ? `Railway did not answer within ${Math.round(this.timeoutMs / 1000)} s.` : `No connection to Railway: ${err instanceof Error ? err.message : String(err)}`,
          secrets: this.secrets(),
        })
      }
      this.noteRateLimit(res.headers)
      const text = await res.text().catch(() => "")
      let json: { data?: unknown; errors?: Array<{ message?: string }> } | null = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }

      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const wait = retryAfterMs(res.headers.get("retry-after"), this.clock.now()) ?? backoffMs(attempt, this.random)
        await this.clock.sleep(Math.min(wait, MAX_RETRY_WAIT_MS))
        continue
      }
      const errors = Array.isArray(json?.errors) ? json!.errors : []
      if (res.status < 200 || res.status >= 300) {
        throw new RailwayApiError({ kind: kindOfStatus(res.status), message: errors[0]?.message ?? `Railway answered HTTP ${res.status}.`, status: res.status, secrets: this.secrets() })
      }
      if (!json || typeof json !== "object") {
        throw new RailwayApiError({ kind: "railway", message: `Railway sent an answer that is not JSON (HTTP ${res.status}).`, status: res.status })
      }
      /* GraphQL answers 200 with errors; partial data (some fields null) is thrown away rather than half shown. */
      if (errors.length) {
        const message = errors.map((e) => String(e?.message ?? "")).filter(Boolean).join("; ") || "Railway refused the query."
        throw new RailwayApiError({ kind: kindOfGraphqlMessage(message), message, status: res.status, secrets: this.secrets() })
      }
      return (json.data ?? {}) as T
    }
  }
}
