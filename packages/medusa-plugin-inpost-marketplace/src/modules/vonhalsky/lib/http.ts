/**
 * THE WIRE: one authenticated request to the InPost Von Halsky seller API.
 *
 * TOKEN. The merchant flow: OAuth2 Client Credentials against InPost's
 * account service, the client authenticated with HTTP Basic (as InPost's own
 * Magento module does), the five scopes of the seller API. An access token
 * lives five minutes; it is kept until 30 seconds before it runs out, one
 * request at a time asks for a new one, and a 401 drops it and tries once
 * more with a fresh one.
 *
 * LIMITS. The API answers `X-RateLimit-Remaining` and `X-RateLimit-Reset`
 * per organization: when nothing remains, the next request waits for the
 * reset (at most 30 seconds). A 429 waits `Retry-After` and tries again, at
 * most twice; a longer wait is an error the caller reports.
 *
 * RETRIES. Only what cannot do a thing twice is retried after a network
 * error or a 5xx: reads (GET). A write that timed out is never sent again
 * blindly; the caller reads the state back (commands, events) instead.
 *
 * ERRORS. InPost answers `application/problem+json`: `errorCode`,
 * `errorMessage` and `details` per field. They become a
 * `MarketplaceApiError` whose message names the fields, with every secret
 * masked.
 */

export const SCOPES = "openid api:categories:read api:offers:read api:offers:write api:orders:read api:orders:write"

export interface HttpConfig {
  apiUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  organizationId: string
  timeoutMs: number
  /** Injected in tests; the global fetch otherwise. */
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** The language of names and descriptions the API translates (Accept-Language). Default "pl". */
  language?: string
}

export type Query = Record<string, string | number | boolean | readonly (string | number)[] | null | undefined>

export interface RequestOptions {
  query?: Query
  body?: unknown
  /** The body's media type. Default JSON; an offer PATCH is `application/merge-patch+json`. */
  contentType?: string
  /** The answer of a 404 instead of an error (a resource that may be gone). */
  notFound?: "null"
}

export interface Http {
  request<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts?: RequestOptions): Promise<T>
  /** The path with the organization filled in: `/v1/organizations/{org}/offers`. */
  org(path: string): string
  /** The last rate limit headers seen, for the admin. */
  limits(): { limit: number | null; remaining: number | null; resetAt: number | null }
}

/** An answer of the seller API that is not a success. */
export class MarketplaceApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Array<{ field: string | null; detail: string }>
  constructor(status: number, code: string, message: string, details: Array<{ field: string | null; detail: string }> = []) {
    super(message)
    this.name = "MarketplaceApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isApiError(err: unknown): err is MarketplaceApiError {
  return err instanceof Error && err.name === "MarketplaceApiError"
}

/** Tokens and bearer values out of a message before it is logged or stored. */
export function maskSecrets(message: string, secrets: readonly string[]): string {
  let out = message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***").replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic ***").replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "***")
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***")
  return out.slice(0, 800)
}

/** `Retry-After` in milliseconds: seconds, or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null
  const s = value.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000)
  const at = Date.parse(s)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

/** The query string, arrays as repeated keys (OpenAPI's form style). */
export function queryString(q: Query | undefined): string {
  if (!q) return ""
  const parts: string[] = []
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue
    const list = Array.isArray(v) ? v : [v]
    for (const x of list) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`)
  }
  return parts.length ? `?${parts.join("&")}` : ""
}

/** The problem+json of an error answer as a readable message. */
export function problemOf(status: number, body: unknown, fallback: string): MarketplaceApiError {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const code = typeof b.errorCode === "string" && b.errorCode ? b.errorCode : status === 429 ? "RATE_LIMIT" : `HTTP_${status}`
  const details = (Array.isArray(b.details) ? b.details : [])
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object")
    .map((d) => ({ field: typeof d.field === "string" ? d.field : null, detail: typeof d.detail === "string" ? d.detail : "" }))
    .filter((d) => d.detail || d.field)
  const head = typeof b.errorMessage === "string" && b.errorMessage ? b.errorMessage : fallback
  const tail = details.length ? `: ${details.slice(0, 8).map((d) => (d.field ? `${d.field} ${d.detail}`.trim() : d.detail)).join("; ")}` : ""
  return new MarketplaceApiError(status, code, `InPost Von Halsky answered ${status} ${code}: ${head}${tail}`, details)
}

const MAX_WAIT_MS = 30_000

export function createHttp(cfg: HttpConfig): Http {
  const doFetch = cfg.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = cfg.now ?? (() => Date.now())
  const secrets = [cfg.clientSecret, cfg.clientId]
  let token: { value: string; until: number } | null = null
  let tokenFlight: Promise<string> | null = null
  const rate: { limit: number | null; remaining: number | null; resetAt: number | null } = { limit: null, remaining: null, resetAt: null }

  async function timed(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
    try {
      return await doFetch(url, { ...init, signal: ctrl.signal })
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError"
      throw new MarketplaceApiError(0, aborted ? "TIMEOUT" : "NETWORK", aborted ? `InPost Von Halsky did not answer within ${cfg.timeoutMs} ms.` : `InPost Von Halsky could not be reached: ${maskSecrets(err instanceof Error ? err.message : String(err), secrets)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => "")
    if (!text.trim()) return null
    try {
      return JSON.parse(text)
    } catch {
      return { errorMessage: text.slice(0, 300) }
    }
  }

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")
    const res = await timed(cfg.tokenUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }).toString(),
    })
    const body = (await readJson(res)) as Record<string, unknown> | null
    if (!res.ok || !body || typeof body.access_token !== "string") {
      const reason = body && typeof body.error_description === "string" ? body.error_description : body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`
      throw new MarketplaceApiError(res.status || 401, "TOKEN", maskSecrets(`InPost refused the API application's credentials (${reason}). Check clientId, clientSecret and the five scopes in the Merchant Portal.`, secrets))
    }
    const seconds = Number(body.expires_in)
    const life = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5 * 60 * 1000
    token = { value: body.access_token, until: now() + Math.max(10_000, life - 30_000) }
    return token.value
  }

  async function bearer(): Promise<string> {
    if (token && token.until > now()) return token.value
    if (!tokenFlight) tokenFlight = fetchToken().finally(() => (tokenFlight = null))
    return tokenFlight
  }

  function noteLimits(res: Response): void {
    const n = (h: string): number | null => {
      const v = res.headers.get(h)
      const x = v === null ? NaN : Number(v)
      return Number.isFinite(x) ? x : null
    }
    rate.limit = n("X-RateLimit-Limit") ?? rate.limit
    rate.remaining = n("X-RateLimit-Remaining")
    const reset = n("X-RateLimit-Reset")
    rate.resetAt = reset === null ? null : reset > 1e12 ? reset : reset * 1000
  }

  async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${cfg.apiUrl}${path}${queryString(opts.query)}`
    let reauthed = false
    for (let attempt = 0; ; attempt += 1) {
      if (rate.remaining === 0 && rate.resetAt && rate.resetAt > now()) await sleep(Math.min(MAX_WAIT_MS, rate.resetAt - now()))
      const headers: Record<string, string> = { Authorization: `Bearer ${await bearer()}`, Accept: "application/json", "Accept-Language": cfg.language ?? "pl" }
      if (opts.body !== undefined) headers["Content-Type"] = opts.contentType ?? "application/json"
      let res: Response
      try {
        res = await timed(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
      } catch (err) {
        if (method === "GET" && attempt < 2) {
          await sleep(500 * 2 ** attempt)
          continue
        }
        throw err
      }
      noteLimits(res)
      if (res.status === 401 && !reauthed) {
        reauthed = true
        token = null
        continue
      }
      if (res.status === 429) {
        const wait = retryAfterMs(res.headers.get("Retry-After"), now()) ?? 1000 * 2 ** attempt
        if (attempt < 2 && wait <= MAX_WAIT_MS) {
          await sleep(wait)
          continue
        }
        throw problemOf(429, await readJson(res), `Too many requests: try again in ${Math.ceil(wait / 1000)} s.`)
      }
      if (res.status >= 500 && method === "GET" && attempt < 2) {
        await sleep(500 * 2 ** attempt)
        continue
      }
      if (res.status === 404 && opts.notFound === "null") return null as T
      if (res.status === 204) return null as T
      const body = await readJson(res)
      if (!res.ok) {
        const e = problemOf(res.status, body, res.statusText || "request failed")
        throw new MarketplaceApiError(e.status, e.code, maskSecrets(e.message, secrets), e.details)
      }
      return body as T
    }
  }

  return {
    request,
    org: (path: string) => path.replace("{org}", encodeURIComponent(cfg.organizationId)),
    limits: () => ({ ...rate }),
  }
}
