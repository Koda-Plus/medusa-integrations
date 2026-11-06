import { RETURNS_HOSTS, RETURNS_SCOPES, RETURNS_TOKEN_MARGIN_MS, type ReturnsEnvironment } from "./constants"
import { flattenDetails, InpostApiError } from "./errors"
import type { LoggerLike } from "./client"
import { maskSecrets } from "./security"

/**
 * THE RETURNS API CLIENT: the only code that talks to the InPost Returns API
 * (InPost Group developer portal, the current "Szybkie Zwroty"). Another API
 * than ShipX: another host, another login, another organization id.
 *
 *   hosts     https://api.inpost-group.com (production) and
 *             https://stage-api.inpost-group.com (stage)
 *   login     OAuth2 client credentials: POST {host}/oauth2/token with
 *             `Authorization: Basic base64(id:secret)` (one method only, the
 *             body carries no secret), scopes api:returns:read and
 *             api:returns:write. The token is kept until shortly before it
 *             expires; a 401 of the API gets one new token and one more try
 *   writes    a create is sent ONCE. No answer, a dropped connection or a 5xx
 *             after it is reported `unclear`: the return may exist, and the
 *             API has no search and no idempotency key, so the flows never
 *             send it again by themselves
 *   masking   the secret and the access token never appear in a message
 *
 * Whether a create may happen at all is decided by the flows (the returns
 * writer must be armed); this file only knows how to send it.
 */

export interface ReturnParcelNumber {
  carrier?: string
  id?: string
  value?: string
}

export interface ReturnParcel {
  id?: string
  trackingNumber?: string | null
  parcelNumbers?: ReturnParcelNumber[] | null
  /** Only for a return without a drop-off code. A link to the label; the plugin never stores it and fetches the label itself. */
  labelUrl?: string | null
  /** Only for a return with a drop-off code (the default). */
  dropOffCode?: string | null
}

export interface ReturnShipment {
  id: string
  expirationDate?: string | null
  parcels?: ReturnParcel[] | null
}

export interface ReturnPerson {
  companyName?: string
  firstName?: string
  lastName?: string
  email: string
  /** E.164, like +48500111222. */
  phone: string
}

/** The body of POST /returns/v1/organizations/{organizationId}/shipments (only `sender` is required). */
export interface ReturnCreateRequest {
  sender: ReturnPerson
  recipient?: ReturnPerson
  origin?: { countryCode: string }
  destination?: { street: string; houseNumber: string; flatNumber?: string; city: string; postalCode: string; countryCode: string }
  references?: { clientId?: string; orderNumber?: string }
  enableDropOffCode?: boolean
  parcels?: Array<{ dimensions?: { length: string; width: string; height: string; unit: string }; weight?: { amount: string; unit: string } }>
  expirationDate?: string
}

export interface ReturnsClientOptions {
  clientId: string
  clientSecret: string
  organizationId: string
  environment: ReturnsEnvironment
  timeoutMs?: number
  userAgent?: string
  logger?: LoggerLike | null
  /** For tests: the fetch to use. Default: the global fetch. */
  fetchImpl?: typeof fetch
  /** For tests: the clock of the token cache. Default: Date.now. */
  now?: () => number
}

export interface ReturnsToken {
  accessToken: string
  expiresAt: number
  scope: string | null
}

export interface ReturnsClient {
  readonly host: string
  /** A fresh token, never the cached one: the "Test connection" of the admin. */
  checkToken(): Promise<{ expiresIn: number; scope: string | null }>
  createShipment(body: ReturnCreateRequest): Promise<ReturnShipment>
  getShipment(id: string): Promise<ReturnShipment>
  /** The label PDF (A4) of a return without a drop-off code, by its tracking number. */
  getLabel(trackingNumber: string): Promise<{ data: Uint8Array; contentType: string }>
}

type Method = "GET" | "POST"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createReturnsClient(opts: ReturnsClientOptions): ReturnsClient {
  const host = RETURNS_HOSTS[opts.environment] ?? RETURNS_HOSTS.production
  const timeoutMs = opts.timeoutMs ?? 20_000
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const clock = opts.now ?? (() => Date.now())
  let cached: ReturnsToken | null = null
  let pending: Promise<ReturnsToken> | null = null
  const mask = (s: string) => maskSecrets(s, [opts.clientSecret, cached?.accessToken])
  const userAgent = opts.userAgent ?? "KodaPlus-Medusa-InPost-Returns/0.4 (+https://koda.plus)"

  async function call(url: string, init: RequestInit, what: string, unclearOnFailure: boolean): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await doFetch(url, { ...init, signal: ctrl.signal })
    } catch (err) {
      const aborted = (err as { name?: string })?.name === "AbortError"
      throw new InpostApiError(
        0,
        aborted ? "timeout" : "network",
        aborted ? `The InPost Returns API did not answer within ${timeoutMs} ms (${what})` : mask(`The InPost Returns API could not be reached (${what}): ${(err as Error)?.message ?? String(err)}`),
        null,
        unclearOnFailure,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async function errorOf(res: Response, method: string, path: string, unclear: boolean): Promise<InpostApiError> {
    const text = await res.text().catch(() => "")
    let parsed: { error?: string; message?: string; details?: unknown } = {}
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {}
    } catch {
      /* an HTML page of a gateway */
    }
    opts.logger?.warn(`[inpost] Returns API ${method} ${path}: ${res.status} ${parsed.error ?? ""}`.trim())
    return new InpostApiError(res.status, parsed.error ?? `http_${res.status}`, mask(parsed.message ?? (text.slice(0, 300) || `HTTP ${res.status}`)), parsed.details ?? null, unclear)
  }

  /* ---------------------------------------------------------------- */
  /* The token                                                         */
  /* ---------------------------------------------------------------- */

  async function fetchToken(): Promise<ReturnsToken> {
    if (!opts.clientId || !opts.clientSecret) throw new InpostApiError(0, "not_configured", "returnsClientId or returnsClientSecret is missing")
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`, "utf8").toString("base64")
    const body = new URLSearchParams({ grant_type: "client_credentials", scope: RETURNS_SCOPES }).toString()
    /* A token request never creates anything: whatever happens here, a create was not sent. */
    const res = await call(
      `${host}/oauth2/token`,
      { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": userAgent }, body },
      "token",
      false,
    )
    if (!res.ok) {
      const err = await errorOf(res, "POST", "/oauth2/token", false)
      throw new InpostApiError(err.status, res.status === 400 || res.status === 401 ? "token_refused" : err.code, err.message, err.details, false)
    }
    const json = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; scope?: unknown } | null
    const accessToken = typeof json?.access_token === "string" ? json.access_token : ""
    if (!accessToken) throw new InpostApiError(502, "token_missing", "The InPost login answered without an access token")
    const expiresIn = Number(json?.expires_in)
    const lifetime = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 300_000
    return { accessToken, expiresAt: clock() + Math.max(5_000, lifetime - RETURNS_TOKEN_MARGIN_MS), scope: typeof json?.scope === "string" ? json.scope : null }
  }

  async function token(fresh = false): Promise<string> {
    if (!fresh && cached && cached.expiresAt > clock()) return cached.accessToken
    if (!pending) {
      pending = fetchToken().finally(() => {
        pending = null
      })
    }
    cached = await pending
    return cached.accessToken
  }

  /* ---------------------------------------------------------------- */
  /* The API                                                           */
  /* ---------------------------------------------------------------- */

  async function send(method: Method, path: string, init: { body?: unknown; accept?: string } = {}): Promise<Response> {
    const write = method !== "GET"
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await token(attempt > 0)
      const res = await call(
        `${host}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${bearer}`,
            Accept: init.accept ?? "application/json",
            "User-Agent": userAgent,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        },
        `${method} ${path.split("?")[0]}`,
        write,
      )
      if (res.ok) return res
      /* A 401 means the request was not taken: one new token, one more try. */
      if (res.status === 401 && attempt === 0) {
        await res.text().catch(() => "")
        cached = null
        continue
      }
      throw await errorOf(res, method, path, write && res.status >= 500)
    }
    throw new InpostApiError(401, "unauthorized", "The InPost Returns API refused the token twice")
  }

  async function json<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const res = await send(method, path, body === undefined ? {} : { body })
    const text = await res.text()
    try {
      return (text ? JSON.parse(text) : undefined) as T
    } catch {
      throw new InpostApiError(res.status, "bad_json", "The InPost Returns API answered with something that is not JSON", null, method !== "GET")
    }
  }

  const org = () => {
    if (!UUID.test(opts.organizationId)) throw new InpostApiError(0, "not_configured", "returnsOrganizationId is missing or not a UUID")
    return opts.organizationId
  }

  return {
    host,
    async checkToken() {
      const t = await fetchToken()
      cached = t
      return { expiresIn: Math.max(0, Math.round((t.expiresAt - clock()) / 1000)), scope: t.scope }
    },
    createShipment: async (body) => json<ReturnShipment>("POST", `/returns/v1/organizations/${org()}/shipments`, body),
    async getShipment(id) {
      const s = String(id ?? "").trim()
      if (!UUID.test(s)) throw new InpostApiError(0, "bad_id", `Not a return shipment id: ${s.slice(0, 40)}`)
      return json<ReturnShipment>("GET", `/returns/v1/organizations/${org()}/shipments/${s.toLowerCase()}`)
    },
    async getLabel(trackingNumber) {
      const tn = String(trackingNumber ?? "").trim()
      if (!/^[0-9A-Za-z]{8,40}$/.test(tn)) throw new InpostApiError(0, "bad_id", `Not a tracking number: ${tn.slice(0, 40)}`)
      const res = await send("GET", `/returns/v1/organizations/${org()}/shipments/${encodeURIComponent(tn)}/label`, { accept: "application/pdf;format=A4" })
      const data = new Uint8Array(await res.arrayBuffer())
      const contentType = res.headers.get("content-type") ?? "application/pdf"
      if (!/pdf/i.test(contentType) || data.length < 20) throw new InpostApiError(502, "label_not_pdf", "The InPost Returns API did not return a PDF label")
      return { data, contentType: "application/pdf" }
    },
  }
}

/** The tracking number, the short number and the drop-off code of the (single) parcel of a return. */
export function returnParcelOf(shipment: ReturnShipment | null | undefined): { parcelId: string | null; trackingNumber: string | null; shortNumber: string | null; dropOffCode: string | null; hasLabel: boolean } {
  const p = Array.isArray(shipment?.parcels) ? shipment?.parcels?.[0] : null
  const numbers = Array.isArray(p?.parcelNumbers) ? (p?.parcelNumbers ?? []) : []
  const standard = numbers.find((n) => n?.id === "STANDARD" && (!n.carrier || n.carrier === "INPOST"))?.value ?? null
  const short = numbers.find((n) => n?.id === "SHORT")?.value ?? null
  const trackingNumber = (typeof p?.trackingNumber === "string" && p.trackingNumber.trim()) || standard || null
  const dropOffCode = typeof p?.dropOffCode === "string" && p.dropOffCode.trim() ? p.dropOffCode.trim() : null
  return {
    parcelId: typeof p?.id === "string" ? p.id : null,
    trackingNumber,
    shortNumber: typeof short === "string" && short.trim() ? short.trim() : null,
    dropOffCode,
    hasLabel: Boolean(typeof p?.labelUrl === "string" && p.labelUrl) || (!dropOffCode && Boolean(trackingNumber)),
  }
}

/** A readable message of a Returns API error, for logs, the database and the admin (mask it before storing). */
export function describeReturnsError(err: unknown): { code: string; message: string; status: number; unclear: boolean } {
  if (err instanceof InpostApiError) {
    const fields = flattenDetails(err.details)
    let message = err.message
    if (err.code === "token_refused") message = "InPost refused the Returns API client id or secret. Check returnsClientId and returnsClientSecret and the environment (stage or production)."
    else if (err.status === 401) message = "The InPost Returns API refused the token (401)."
    else if (err.status === 403) message = "The InPost Returns API refused access (403): the client needs the scopes api:returns:read and api:returns:write, and returnsOrganizationId must be the organization UUID of this client."
    else if (err.status === 404) message = "The InPost Returns API has no such return (404)."
    else if (fields.length > 0) message = `${err.message} (${fields.join("; ")})`
    return { code: err.code, message: message.slice(0, 1000), status: err.status, unclear: err.unclear }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { code: "error", message: message.slice(0, 1000), status: 0, unclear: false }
}
