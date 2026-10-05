/**
 * THE ONLY HTTP CLIENT FOR THE OLX PARTNER API. OLX URLs must not appear
 * anywhere else in the plugin.
 *
 * Every API call goes through the same order: write barrier, rate limiter,
 * fetch with a timeout. OAuth runs through dedicated methods against the token
 * endpoint, the only POST the barrier lets through without a writer.
 *
 * ERROR POLICY FOR READS
 *   network, timeout, HTTP 5xx   up to 3 attempts, pauses of 1 s and 4 s
 *   HTTP 429                     one wait (Retry-After, at most 2 minutes,
 *                                otherwise 60 s) and one more attempt
 *   HTTP 403 from the CDN        the IP block after 4 500 requests in 5
 *                                minutes: no retry, the caller pauses 30 min
 *   HTTP 401                     NOT retried here; the caller refreshes the
 *                                token and calls once more
 *   other 4xx                    permanent, thrown right away
 *
 * WRITES ARE NEVER RETRIED HERE. A write that got no clear answer (timeout,
 * network, 5xx) throws `OlxUnknownResultError`: the caller looks the advert
 * up before anything is sent again. A 429 on a write means OLX took nothing.
 *
 * Tokens come IN as arguments, they never live in this file.
 *
 * WHAT THE OLX DOCS SAY (developer.olx.pl, see docs/olx-api-notes.md): code
 * exchange and refresh are JSON POSTs to `/api/open/oauth/token`; the access
 * token lives 24 hours (`expires_in` 86400), the refresh token one month
 * and a new one may come back on every refresh. Every Partner API request
 * carries `Version: 2.0`; a GET must not carry `Content-Type`.
 */

import type { Logger } from "@medusajs/framework/types"
import { API_VERSION, type OlxUrls } from "./constants"
import { OlxApiError, OlxUnknownResultError, describeValidation, looksLikeIpBlock, parseValidation } from "./errors"
import { OlxWriteBlockedError, isRequestAllowed, maskSecrets, type WriteKind } from "./security"

export { OlxApiError, OlxUnknownResultError }

export interface TokenPair {
  access_token: string
  refresh_token: string
  /** Seconds the access token is valid (OLX: 86400). */
  expires_in: number
  scope: string
}

/* ------------------------------------------------------------------ */
/* Rate limiter: one per process, shared by every client instance      */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 60_000
const SPACING_MS = 250
const LIMITER_KEY = Symbol.for("koda.olx.limiter")

interface Limiter {
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
      chain = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}

function globalLimiter(perMinute: number): Limiter {
  const holder = globalThis as typeof globalThis & { [LIMITER_KEY]?: Limiter }
  if (!holder[LIMITER_KEY]) holder[LIMITER_KEY] = buildLimiter(Math.max(1, perMinute))
  return holder[LIMITER_KEY] as Limiter
}

/** Seconds of a Retry-After header, bounded to two minutes; null when absent or a date. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(120_000, Math.max(1_000, Math.round(seconds * 1000)))
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface OlxClientOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  urls: OlxUrls
  requestsPerMinute: number
  timeoutMs: number
  userAgent: string
  logger: Logger
}

export class OlxClient {
  private readonly o: OlxClientOptions
  private readonly limiter: Limiter

  constructor(options: OlxClientOptions) {
    this.o = options
    this.limiter = globalLimiter(options.requestsPerMinute)
  }

  /** Masks the app secret. Tokens are masked by the caller, the only one who knows them. */
  mask(text: string, tokens: readonly string[] = []): string {
    return maskSecrets(text, [this.o.clientSecret, ...tokens])
  }

  /* ---- OAuth: authorization code ----------------------------------- */

  /**
   * Consent page. The seller, logged in to OLX, opens it and approves; OLX
   * then sends the browser to `redirectUri` with `code` and `state`.
   */
  authorizeUrl(state: string, scope: string): string {
    const url = new URL(this.o.urls.authorize)
    url.searchParams.set("client_id", this.o.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("state", state)
    url.searchParams.set("scope", scope)
    url.searchParams.set("redirect_uri", this.o.redirectUri)
    return url.toString()
  }

  /** Token pair for the one-time code from the callback (valid 10 minutes on the OLX side). */
  async exchangeCode(code: string, scope: string): Promise<TokenPair> {
    const { res, json } = await this.oauthPost({
      grant_type: "authorization_code",
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
      code,
      scope,
      redirect_uri: this.o.redirectUri,
    })
    if (!res.ok) throw new OlxApiError(res.status, this.describeOauthError(json), res.status >= 500)
    return this.pair(json, res.status)
  }

  /**
   * New pair for a refresh token. Up to three attempts, only on network
   * errors, timeouts and 5xx; a 4xx (`invalid_grant`) is final: the refresh
   * token was revoked or a month passed without a refresh.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let last: OlxApiError | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(1000)
      try {
        const { res, json } = await this.oauthPost({
          grant_type: "refresh_token",
          client_id: this.o.clientId,
          client_secret: this.o.clientSecret,
          refresh_token: refreshToken,
        })
        if (res.ok) return this.pair(json, res.status, refreshToken)
        const err = new OlxApiError(res.status, this.describeOauthError(json), res.status >= 500)
        if (!err.transient) throw err
        last = err
      } catch (err) {
        if (err instanceof OlxApiError) {
          if (!err.transient) throw err
          last = err
        } else {
          last = new OlxApiError(0, `OLX OAuth: ${this.mask(String(err), [refreshToken])}`, true)
        }
      }
    }
    throw last ?? new OlxApiError(0, "OLX OAuth: refresh without a response", true)
  }

  /**
   * @param previousRefresh When OLX does not send a new refresh token (the
   * docs say it may come back unchanged within a day), we keep the old one
   * instead of saving an empty string and silently disconnecting the account.
   */
  private pair(json: Record<string, unknown>, status: number, previousRefresh = ""): TokenPair {
    const pair = {
      access_token: String(json.access_token ?? ""),
      refresh_token: String(json.refresh_token ?? "") || previousRefresh,
      expires_in: Number(json.expires_in ?? 86400),
      scope: String(json.scope ?? ""),
    }
    if (!pair.access_token || !pair.refresh_token) {
      throw new OlxApiError(status, "OLX OAuth: 200 response without access_token or refresh_token", false)
    }
    return pair
  }

  private describeOauthError(json: Record<string, unknown>): string {
    /* OLX describes errors either as `error`/`error_description` (OAuth) or
     * as `error: { title, detail }` (Partner API). We read both. */
    const e = json.error
    if (e && typeof e === "object") {
      const o = e as Record<string, unknown>
      return this.mask(`OLX OAuth: ${String(o.title ?? "error")} ${String(o.detail ?? "")}`.trim())
    }
    return this.mask(`OLX OAuth: ${String(e ?? "error")} ${String(json.error_description ?? "")}`.trim())
  }

  /**
   * JSON POST to the token endpoint, response read through `text()`: a 502
   * from a proxy brings HTML, and `res.json()` would throw a SyntaxError
   * without the status and without the transient flag.
   */
  private async oauthPost(body: Record<string, string>): Promise<{ res: Response; json: Record<string, unknown> }> {
    const tokenUrl = this.o.urls.token
    const verdict = isRequestAllowed({ method: "POST", url: tokenUrl, tokenUrl })
    if (!verdict.ok) throw new OlxWriteBlockedError("POST", tokenUrl, verdict.reason)
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": this.o.userAgent,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs),
    })
    const text = await res.text()
    try {
      const json = JSON.parse(text) as unknown
      return { res, json: json && typeof json === "object" ? (json as Record<string, unknown>) : {} }
    } catch {
      throw new OlxApiError(res.status, this.mask(`OLX OAuth ${res.status}: ${text.slice(0, 200)}`), res.status >= 500)
    }
  }

  /* ---- Partner API: reads ------------------------------------------ */

  /**
   * GET with an access token. Retries only what is transient. A 401 goes
   * up without a retry: the caller refreshes the token and calls once more.
   */
  async get<T>(path: string, query: Record<string, string>, accessToken: string): Promise<T> {
    const url = new URL(`${this.o.urls.api}${path}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const verdict = isRequestAllowed({ method: "GET", url: url.toString(), tokenUrl: this.o.urls.token })
    if (!verdict.ok) throw new OlxWriteBlockedError("GET", url.toString(), verdict.reason)

    const PAUSES_MS = [0, 1000, 4000]
    let last: unknown = null
    let waited429 = false
    for (let attempt = 0; attempt < PAUSES_MS.length; attempt += 1) {
      if (PAUSES_MS[attempt] > 0) await sleep(PAUSES_MS[attempt])
      await this.limiter.pass()
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: API_VERSION,
            Accept: "application/json",
            "User-Agent": this.o.userAgent,
          },
          signal: AbortSignal.timeout(this.o.timeoutMs),
        })
        if (res.ok) return (await res.json()) as T
        const raw = await res.text()
        const body = this.mask(raw.slice(0, 300), [accessToken])
        if (looksLikeIpBlock(res.status, raw)) {
          throw new OlxApiError(403, `OLX blocked requests from this IP (403, about 30 minutes) on ${path}.`, false, { blocked: true })
        }
        if (res.status === 429) {
          if (!waited429) {
            waited429 = true
            const wait = retryAfterMs(res.headers.get("retry-after")) ?? 60_000
            this.o.logger.warn(`[olx] 429 on ${path}, waiting ${Math.round(wait / 1000)} s.`)
            await sleep(wait)
            last = new OlxApiError(429, `OLX 429 on ${path}: ${body}`, true)
            attempt -= 1
            continue
          }
          throw new OlxApiError(429, `OLX 429 on ${path} after waiting: ${body}`, false)
        }
        if (res.status >= 500) {
          last = new OlxApiError(res.status, `OLX ${res.status} on ${path}: ${body}`, true)
          continue
        }
        throw new OlxApiError(res.status, `OLX ${res.status} on ${path}: ${body}`, false)
      } catch (err) {
        if (err instanceof OlxApiError) {
          if (!err.transient) throw err
          last = err
          continue
        }
        last = new OlxApiError(0, `OLX ${path}: ${this.mask(String(err), [accessToken])}`, true)
      }
    }
    throw last instanceof Error ? last : new OlxApiError(0, `OLX ${path}: unknown error`, true)
  }

  /* ---- Partner API: the three writes ------------------------------- */

  /**
   * One write, ONE attempt. The barrier checks it against the writers armed
   * for this call. Answers:
   *   2xx                 the parsed body (null for 204 or an empty body;
   *                       `undefined` when the body is not JSON)
   *   4xx with a reason   OlxApiError with the validation issues
   *   429, IP block       OlxApiError marked as throttling (nothing applied)
   *   5xx, timeout, net   OlxUnknownResultError (maybe applied)
   */
  async send(
    method: "POST" | "PUT",
    path: string,
    body: Record<string, unknown>,
    accessToken: string,
    allow: readonly WriteKind[],
  ): Promise<unknown> {
    const url = `${this.o.urls.api}${path}`
    const verdict = isRequestAllowed({ method, url, tokenUrl: this.o.urls.token, apiBase: this.o.urls.api, body, allow })
    if (!verdict.ok) throw new OlxWriteBlockedError(method, url, verdict.reason)
    await this.limiter.pass()
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: API_VERSION,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": this.o.userAgent,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      })
    } catch (err) {
      throw new OlxUnknownResultError(`${method} ${path}`, new Error(this.mask(String(err), [accessToken])))
    }
    let raw = ""
    try {
      raw = await res.text()
    } catch (err) {
      if (res.ok) throw new OlxUnknownResultError(`${method} ${path}`, err)
    }
    let json: unknown
    try {
      json = raw ? (JSON.parse(raw) as unknown) : null
    } catch {
      json = undefined
    }
    if (res.ok) return json
    const masked = this.mask(raw.slice(0, 300), [accessToken])
    if (looksLikeIpBlock(res.status, raw)) {
      throw new OlxApiError(403, `OLX blocked requests from this IP (403, about 30 minutes) on ${method} ${path}.`, false, { blocked: true })
    }
    if (res.status === 429) throw new OlxApiError(429, `OLX 429 on ${method} ${path}: ${masked}`, true)
    if (res.status >= 500) throw new OlxUnknownResultError(`${method} ${path}`, new Error(`HTTP ${res.status}: ${masked}`))
    const parsed = parseValidation(json)
    const reason = this.mask(describeValidation(parsed.detail, parsed.issues))
    throw new OlxApiError(res.status, `OLX ${res.status} on ${method} ${path}: ${reason || masked}`, false, { validation: parsed.issues })
  }
}
