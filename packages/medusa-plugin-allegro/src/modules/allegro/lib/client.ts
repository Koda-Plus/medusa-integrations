/**
 * THE ONLY HTTP CLIENT FOR ALLEGRO. Allegro URLs must not appear anywhere
 * else in the plugin.
 *
 * Every call goes through the same order: write barrier, rate limiter, fetch
 * with a timeout. OAuth runs through dedicated methods against the two OAuth
 * endpoints, the only POSTs the barrier lets through.
 *
 * ERROR POLICY
 *   network, timeout, HTTP 5xx   up to 3 attempts, pauses of 1 s and 4 s
 *   HTTP 429                     one 60 s wait and one more attempt
 *   HTTP 401 and 403             NOT retried here; the caller refreshes the
 *                                token and calls once more (the Allegro
 *                                swagger documents an invalid token as 403,
 *                                the tutorials as 401)
 *   other 4xx                    permanent, thrown right away
 *
 * THE REFRESH HAS ITS OWN RETRY. After a refresh Allegro rotates the pair and
 * the old refresh token keeps working for 60 seconds only: when the new pair
 * was issued but the response got lost, retrying inside that window is the
 * only way to keep the connection. Up to three attempts a second apart, only
 * on network errors, timeouts and 5xx; a 4xx (`invalid_grant`) is final.
 *
 * Tokens come IN as arguments, they never live in this file.
 *
 * Device flow (developer.allegro.pl, RFC 8628): `POST /auth/oauth/device`
 * with HTTP Basic and the scope gives a `user_code` for a person and a
 * `device_code` for us; the person types the code at allegro.pl/skojarz-aplikacje
 * and we poll `POST /auth/oauth/token` with the device code grant. The REST
 * API wants `Accept: application/vnd.allegro.public.v1+json`. Rate limit:
 * 9 000 requests per minute per client id; the plugin limits itself to 300.
 */

import type { Logger } from "@medusajs/framework/types"
import { DEVICE_GRANT, MEDIA_TYPE, type AllegroUrls } from "./constants"
import { AllegroWriteBlockedError, isRequestAllowed, maskSecrets } from "./security"

export class AllegroApiError extends Error {
  readonly status: number
  readonly transient: boolean
  constructor(status: number, message: string, transient: boolean) {
    super(message)
    this.name = "AllegroApiError"
    this.status = status
    this.transient = transient
  }
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  /** Seconds the access token is valid (Allegro: 43 199). */
  expires_in: number
  scope: string
}

export interface DeviceStart {
  user_code: string
  device_code: string
  /** Seconds the codes stay valid (Allegro: 3 600). */
  expires_in: number
  /** Seconds between polls. */
  interval: number
  verification_uri_complete: string
}

export type DevicePoll =
  | { state: "done"; pair: TokenPair }
  | { state: "pending"; intervalS: number }
  | { state: "denied" }
  | { state: "expired" }

/* ------------------------------------------------------------------ */
/* Rate limiter: one per process, shared by every client instance      */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 60_000
const SPACING_MS = 200
const LIMITER_KEY = Symbol.for("koda.allegro.limiter")

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

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface AllegroClientOptions {
  clientId: string
  clientSecret: string
  urls: AllegroUrls
  scope: string
  requestsPerMinute: number
  timeoutMs: number
  userAgent: string
  logger: Logger
}

export class AllegroClient {
  private readonly o: AllegroClientOptions
  private readonly limiter: Limiter

  constructor(options: AllegroClientOptions) {
    this.o = options
    this.limiter = globalLimiter(options.requestsPerMinute)
  }

  /** Masks the app secret. Tokens are masked by the caller, the only one who knows them. */
  mask(text: string, tokens: readonly string[] = []): string {
    return maskSecrets(text, [this.o.clientSecret, ...tokens])
  }

  private basic(): string {
    return "Basic " + Buffer.from(`${this.o.clientId}:${this.o.clientSecret}`, "utf8").toString("base64")
  }

  /* ---- OAuth: device flow ------------------------------------------- */

  /**
   * Step one: a code for a person. The seller types it at the address in
   * `verification_uri_complete` (allegro.pl/skojarz-aplikacje) and approves.
   */
  async startDevice(): Promise<DeviceStart> {
    const url = `${this.o.urls.device}?client_id=${encodeURIComponent(this.o.clientId)}`
    const { res, json } = await this.oauthPost(url, `scope=${encodeURIComponent(this.o.scope)}`)
    if (!res.ok) throw new AllegroApiError(res.status, this.describeOauthError(json), res.status >= 500)
    const start = {
      user_code: String(json.user_code ?? ""),
      device_code: String(json.device_code ?? ""),
      expires_in: Number(json.expires_in ?? 3600),
      interval: Number(json.interval ?? 5),
      verification_uri_complete: String(json.verification_uri_complete ?? ""),
    }
    if (!start.user_code || !start.device_code) {
      throw new AllegroApiError(res.status, "Allegro OAuth: device response without user_code or device_code", false)
    }
    return start
  }

  /**
   * One poll for the token. Called every `intervalS` seconds while pending.
   * On `slow_down` the interval grows by 5 s, as RFC 8628 says.
   */
  async pollDevice(deviceCode: string, intervalS: number): Promise<DevicePoll> {
    const body = `grant_type=${encodeURIComponent(DEVICE_GRANT)}&device_code=${encodeURIComponent(deviceCode)}`
    const { res, json } = await this.oauthPost(this.o.urls.token, body)
    if (res.ok) return { state: "done", pair: this.pair(json, res.status) }
    const error = String(json.error ?? "")
    if (error === "authorization_pending") return { state: "pending", intervalS }
    if (error === "slow_down") return { state: "pending", intervalS: intervalS + 5 }
    if (error === "access_denied") return { state: "denied" }
    /* The Allegro docs list four 400 answers; the fourth is
     * `{"error": "Invalid device code"}`: "the code is invalid or already
     * used". There is no separate expiry code, after `expires_in` the same
     * sentence comes back. `expired_token` (RFC 8628) and `invalid_grant`
     * (RFC 6749) are kept in case Allegro moves to the standard. */
    if (error === "expired_token" || error === "invalid_grant" || /invalid device code/i.test(error)) {
      return { state: "expired" }
    }
    throw new AllegroApiError(res.status, this.describeOauthError(json), res.status >= 500)
  }

  /** New pair for a refresh token. The old pair keeps working for 60 s after this. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    let last: AllegroApiError | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(1000)
      try {
        const { res, json } = await this.oauthPost(this.o.urls.token, body)
        if (res.ok) return this.pair(json, res.status)
        /* 400 invalid_grant: the refresh token was revoked (consent removed,
         * password changed, three months without a refresh). Final. */
        const err = new AllegroApiError(res.status, this.describeOauthError(json), res.status >= 500)
        if (!err.transient) throw err
        last = err
      } catch (err) {
        if (err instanceof AllegroApiError) {
          if (!err.transient) throw err
          last = err
        } else {
          last = new AllegroApiError(0, `Allegro OAuth: ${this.mask(String(err), [refreshToken])}`, true)
        }
      }
    }
    throw last ?? new AllegroApiError(0, "Allegro OAuth: refresh without a response", true)
  }

  private pair(json: Record<string, unknown>, status: number): TokenPair {
    const pair = {
      access_token: String(json.access_token ?? ""),
      refresh_token: String(json.refresh_token ?? ""),
      expires_in: Number(json.expires_in ?? 43199),
      scope: String(json.scope ?? ""),
    }
    /* A 200 without tokens is an answer we do not understand; saving empty
     * strings would show "connected" with nothing to read with. */
    if (!pair.access_token || !pair.refresh_token) {
      throw new AllegroApiError(status, "Allegro OAuth: 200 response without access_token or refresh_token", false)
    }
    return pair
  }

  private describeOauthError(json: Record<string, unknown>): string {
    return this.mask(`Allegro OAuth: ${String(json.error ?? "error")} ${String(json.error_description ?? "")}`.trim())
  }

  /**
   * Form POST to the OAuth server with HTTP Basic, response read through
   * `text()`: a 502 from a proxy brings HTML, and `res.json()` would throw a
   * SyntaxError without the status and without the transient flag.
   */
  private async oauthPost(url: string, body: string): Promise<{ res: Response; json: Record<string, unknown> }> {
    const verdict = isRequestAllowed({ method: "POST", url, oauthUrls: [this.o.urls.device, this.o.urls.token] })
    if (!verdict.ok) throw new AllegroWriteBlockedError("POST", url, verdict.reason)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.basic(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": this.o.userAgent,
      },
      body,
      signal: AbortSignal.timeout(this.o.timeoutMs),
    })
    const text = await res.text()
    try {
      const json = JSON.parse(text) as unknown
      return { res, json: json && typeof json === "object" ? (json as Record<string, unknown>) : {} }
    } catch {
      throw new AllegroApiError(res.status, this.mask(`Allegro OAuth ${res.status}: ${text.slice(0, 200)}`), res.status >= 500)
    }
  }

  /* ---- REST API: read only ----------------------------------------- */

  /**
   * GET with an access token. Retries only what is transient. 401 and 403 go
   * up without a retry: the caller refreshes the token and calls once more.
   */
  async get<T>(path: string, query: Record<string, string | string[]>, accessToken: string): Promise<T> {
    const url = new URL(`${this.o.urls.api}${path}`)
    for (const [k, v] of Object.entries(query)) {
      for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one)
    }
    const verdict = isRequestAllowed({ method: "GET", url: url.toString(), oauthUrls: [] })
    if (!verdict.ok) throw new AllegroWriteBlockedError("GET", url.toString(), verdict.reason)

    const PAUSES_MS = [0, 1000, 4000]
    let last: unknown = null
    for (let attempt = 0; attempt < PAUSES_MS.length; attempt += 1) {
      if (PAUSES_MS[attempt] > 0) await sleep(PAUSES_MS[attempt])
      await this.limiter.pass()
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: MEDIA_TYPE,
            "Accept-Language": "en-US",
            "User-Agent": this.o.userAgent,
          },
          signal: AbortSignal.timeout(this.o.timeoutMs),
        })
        if (res.ok) return (await res.json()) as T
        const text = this.mask((await res.text()).slice(0, 300), [accessToken])
        if (res.status === 429) {
          /* The docs do not describe Retry-After, so we wait the whole window. */
          if (attempt === 0) {
            this.o.logger.warn(`[allegro] 429 on ${path}, waiting 60 s.`)
            await sleep(60_000)
            last = new AllegroApiError(429, `Allegro 429 on ${path}: ${text}`, true)
            continue
          }
          throw new AllegroApiError(429, `Allegro 429 on ${path} after waiting a minute: ${text}`, false)
        }
        if (res.status >= 500) {
          last = new AllegroApiError(res.status, `Allegro ${res.status} on ${path}: ${text}`, true)
          continue
        }
        throw new AllegroApiError(res.status, `Allegro ${res.status} on ${path}: ${text}`, false)
      } catch (err) {
        if (err instanceof AllegroApiError) {
          if (!err.transient) throw err
          last = err
          continue
        }
        last = new AllegroApiError(0, `Allegro ${path}: ${this.mask(String(err), [accessToken])}`, true)
      }
    }
    throw last instanceof Error ? last : new AllegroApiError(0, `Allegro ${path}: unknown error`, true)
  }
}
