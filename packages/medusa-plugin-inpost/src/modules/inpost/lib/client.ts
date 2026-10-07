import { SHIPX_HOSTS } from "./constants"
import { InpostApiError } from "./errors"
import type { ShipxCreatePayload } from "./plan"
import { maskSecrets } from "./security"

/**
 * THE SHIPX CLIENT: the only code that talks to the ShipX API with the token.
 *
 *   hosts     https://api-shipx-pl.easypack24.net (production) and
 *             https://sandbox-api-shipx-pl.easypack24.net (sandbox)
 *   auth      `Authorization: Bearer <token>`, never in a URL, masked in
 *             every message
 *   retries   only reads (GET) are tried again, twice, after a network error,
 *             a 429 or a 5xx; a write (create, buy, cancel, dispatch order) is
 *             sent once, and an answer that never came is reported `unclear`
 *   pacing    a self-imposed limit of requests per minute per process
 *
 * Whether a write may happen at all is decided by the flows (the writer must
 * be armed); this file only knows how to send it.
 */

export interface ShipxOffer {
  id: number | string
  status?: string
  rate?: number | null
  currency?: string | null
  expires_at?: string | null
  service?: { id?: string; name?: string } | null
  unavailability_reasons?: Array<{ key?: string; message?: string }> | null
}

export interface ShipxShipment {
  id: number | string
  status: string
  tracking_number?: string | null
  service?: string | null
  reference?: string | null
  sending_method?: string | null
  parcels?: Array<{ id?: number | string; tracking_number?: string | null; template?: string | null }> | null
  custom_attributes?: { target_point?: string | null; sending_method?: string | null; dropoff_point?: string | null; dispatch_order_id?: number | string | null } | null
  cod?: { amount?: number | string | null; currency?: string | null } | null
  offers?: ShipxOffer[] | null
  selected_offer?: ShipxOffer | null
  transactions?: Array<{ status?: string; details?: unknown }> | null
  created_at?: string
  updated_at?: string
}

export interface ShipxDispatchOrderRequest {
  shipments: Array<number | string>
  name: string
  phone: string
  email?: string
  comment?: string
  address: { street: string; building_number: string; flat_number?: string; city: string; post_code: string; country_code: string }
}

export interface ShipxDispatchOrder {
  id: number | string
  status?: string
  external_id?: string | null
}

export interface ShipxOrganization {
  id: number | string
  name?: string
  status?: string
  services?: string[]
}

export interface LoggerLike {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface ShipxClientOptions {
  token: string
  organizationId: string
  sandbox?: boolean
  timeoutMs?: number
  requestsPerMinute?: number
  userAgent?: string
  logger?: LoggerLike | null
  /** For tests: the fetch to use. Default: the global fetch. */
  fetchImpl?: typeof fetch
  /** For tests: how a retry waits. Default: a real timer. */
  sleep?: (ms: number) => Promise<void>
}

export interface ShipxClient {
  readonly host: string
  getOrganization(): Promise<ShipxOrganization>
  createShipment(payload: ShipxCreatePayload): Promise<ShipxShipment>
  getShipment(id: string | number): Promise<ShipxShipment>
  /** Shipments of the organization by the documented filters (receiver_email, receiver_phone, created_at_gteq...). */
  findShipments(filters: Record<string, string>): Promise<ShipxShipment[]>
  cancelShipment(id: string | number): Promise<void>
  buyOffer(id: string | number, offerId: string | number): Promise<ShipxShipment>
  getLabel(id: string | number, type: "normal" | "A6"): Promise<{ data: Uint8Array; contentType: string }>
  createDispatchOrder(body: ShipxDispatchOrderRequest): Promise<ShipxDispatchOrder>
}

type Method = "GET" | "POST" | "DELETE"

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createShipxClient(opts: ShipxClientOptions): ShipxClient {
  const host = opts.sandbox ? SHIPX_HOSTS.sandbox : SHIPX_HOSTS.production
  const timeoutMs = opts.timeoutMs ?? 20_000
  const minGap = Math.ceil(60_000 / Math.max(1, opts.requestsPerMinute ?? 60))
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = opts.sleep ?? realSleep
  const mask = (s: string) => maskSecrets(s, [opts.token])
  let nextSlot = 0

  async function pace(): Promise<void> {
    const now = Date.now()
    const wait = nextSlot - now
    nextSlot = Math.max(now, nextSlot) + minGap
    if (wait > 0) await sleep(wait)
  }

  async function send(method: Method, path: string, init: { body?: unknown; accept?: string; retries?: number } = {}): Promise<Response> {
    const retries = method === "GET" ? (init.retries ?? 2) : 0
    let last: InpostApiError | null = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(500 * attempt)
      await pace()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      let res: Response
      try {
        res = await doFetch(`${host}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${opts.token}`,
            Accept: init.accept ?? "application/json",
            "User-Agent": opts.userAgent ?? "KodaPlus-Medusa-InPost/0.1 (+https://koda.plus)",
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: ctrl.signal,
        })
      } catch (err) {
        const aborted = (err as { name?: string })?.name === "AbortError"
        last = new InpostApiError(0, aborted ? "timeout" : "network", aborted ? `ShipX did not answer within ${timeoutMs} ms` : mask(`ShipX could not be reached: ${(err as Error)?.message ?? String(err)}`), null, true)
        if (attempt < retries) continue
        throw last
      } finally {
        clearTimeout(timer)
      }
      if (res.ok) return res
      const text = await res.text().catch(() => "")
      let parsed: { error?: string; key?: string; message?: string; details?: unknown } = {}
      try {
        parsed = text ? (JSON.parse(text) as typeof parsed) : {}
      } catch {
        /* an HTML page of a gateway */
      }
      const transient = res.status >= 500 || res.status === 429
      last = new InpostApiError(
        res.status,
        parsed.error ?? parsed.key ?? `http_${res.status}`,
        mask(parsed.message ?? (text.slice(0, 300) || `HTTP ${res.status}`)),
        parsed.details ?? null,
        transient && method !== "GET",
      )
      opts.logger?.warn(`[inpost] ShipX ${method} ${path.split("?")[0]}: ${res.status} ${last.code}`)
      if (transient && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"))
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 30) await sleep(retryAfter * 1000)
        continue
      }
      throw last
    }
    throw last ?? new InpostApiError(0, "network", "ShipX could not be reached", null, method !== "GET")
  }

  async function json<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const res = await send(method, path, body === undefined ? {} : { body })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    try {
      return (text ? JSON.parse(text) : undefined) as T
    } catch {
      throw new InpostApiError(res.status, "bad_json", "ShipX answered with something that is not JSON", null, method !== "GET")
    }
  }

  const org = () => {
    if (!/^\d+$/.test(opts.organizationId)) throw new InpostApiError(0, "not_configured", "organizationId is missing or not a number")
    return opts.organizationId
  }
  const sid = (id: string | number) => {
    const s = String(id).trim()
    if (!/^\d{1,15}$/.test(s)) throw new InpostApiError(0, "bad_id", `Not a ShipX shipment id: ${s.slice(0, 20)}`)
    return s
  }

  /* Every method is async, so a bad id or a missing organization rejects like any other error. */
  return {
    host,
    getOrganization: async () => json<ShipxOrganization>("GET", `/v1/organizations/${org()}`),
    createShipment: async (payload) => json<ShipxShipment>("POST", `/v1/organizations/${org()}/shipments`, payload),
    getShipment: async (id) => json<ShipxShipment>("GET", `/v1/shipments/${sid(id)}`),
    async findShipments(filters) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
      params.set("per_page", "25")
      const body = await json<{ items?: ShipxShipment[] }>("GET", `/v1/organizations/${org()}/shipments?${params.toString()}`)
      return Array.isArray(body?.items) ? body.items : []
    },
    async cancelShipment(id) {
      await send("DELETE", `/v1/shipments/${sid(id)}`)
    },
    buyOffer: async (id, offerId) => json<ShipxShipment>("POST", `/v1/shipments/${sid(id)}/buy`, { offer_id: Number(offerId) }),
    async getLabel(id, type) {
      const res = await send("GET", `/v1/shipments/${sid(id)}/label?format=pdf&type=${type}`, { accept: "application/pdf" })
      const data = new Uint8Array(await res.arrayBuffer())
      const contentType = res.headers.get("content-type") ?? "application/pdf"
      if (!/pdf/i.test(contentType) || data.length < 20) {
        throw new InpostApiError(502, "label_not_pdf", "ShipX did not return a PDF label")
      }
      return { data, contentType: "application/pdf" }
    },
    createDispatchOrder: async (body) => json<ShipxDispatchOrder>("POST", `/v1/organizations/${org()}/dispatch_orders`, body),
  }
}
