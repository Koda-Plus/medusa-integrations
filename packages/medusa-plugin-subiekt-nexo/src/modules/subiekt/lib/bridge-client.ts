/**
 * THE BRIDGE AS MEDUSA SEES IT: one interface, two implementations.
 *
 * - `HttpBridgeClient` signs every request and talks to a real bridge.
 * - `DemoBridge` (`./demo.ts`) answers the same calls from the database,
 *   so the whole flow runs without Subiekt.
 *
 * ERRORS ARE CLASSIFIED ONCE, HERE. Each failure becomes a `BridgeError`
 * with `retryable`, and the task queue only reads that flag:
 * - network failures, timeouts, 429 and 5xx: retry with backoff;
 * - 4xx with a contract error body: the bridge's own `retryable`;
 * - other 4xx: a configuration problem, no retry until someone fixes it.
 *
 * A timeout while creating a ZK is ambiguous (the ZK may exist), which is
 * exactly why `POST /v1/orders` is idempotent: the retry returns that ZK.
 */

import type {
  BridgeErrorBody,
  BridgeHealth,
  CancelResult,
  ContractOrder,
  EventsPage,
  FulfillmentRequest,
  FulfillmentResult,
  OrderResult,
  OrderStatusResult,
  StockPage,
} from "./contract"
import { signatureHeader } from "./signature"

export interface BridgeApi {
  readonly mode: "demo" | "live"
  health(): Promise<BridgeHealth>
  createOrder(order: ContractOrder): Promise<OrderResult>
  getOrder(orderId: string): Promise<OrderStatusResult | null>
  cancelOrder(orderId: string, reason: string | null): Promise<CancelResult>
  createFulfillment(orderId: string, request: FulfillmentRequest): Promise<FulfillmentResult>
  listStock(cursor: string | null, limit: number): Promise<StockPage>
  listEvents(after: number, limit: number): Promise<EventsPage>
}

export class BridgeError extends Error {
  readonly code: string
  /** HTTP status, 0 when the bridge was not reached at all. */
  readonly status: number
  readonly retryable: boolean
  readonly details: Record<string, unknown> | null

  constructor(args: { code: string; message: string; status: number; retryable: boolean; details?: Record<string, unknown> | null }) {
    super(args.message)
    this.name = "BridgeError"
    this.code = args.code
    this.status = args.status
    this.retryable = args.retryable
    this.details = args.details ?? null
  }
}

const MAX_MESSAGE = 600

function clip(text: string): string {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}...` : text
}

function isErrorBody(value: unknown): value is BridgeErrorBody {
  if (!value || typeof value !== "object") return false
  const e = (value as { error?: unknown }).error
  return Boolean(e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string")
}

/** A non-2xx answer from the bridge (or from a proxy in front of it). */
export function classifyHttpError(status: number, body: unknown, rawText: string): BridgeError {
  if (isErrorBody(body)) {
    const e = body.error
    const retryable = status >= 500 || status === 429 ? true : Boolean(e.retryable)
    return new BridgeError({
      code: e.code,
      message: clip(String(e.message ?? `HTTP ${status}`)),
      status,
      retryable,
      details: e.details ?? null,
    })
  }
  if (status === 429) return new BridgeError({ code: "busy", message: "The bridge is busy (HTTP 429).", status, retryable: true })
  if (status >= 500) {
    // Typically the tunnel or a proxy answering for a bridge that is down.
    return new BridgeError({
      code: "bridge_unavailable",
      message: clip(`The bridge answered HTTP ${status}${rawText ? `: ${rawText.replace(/\s+/g, " ").trim()}` : ""}`),
      status,
      retryable: true,
    })
  }
  if (status === 401 || status === 403) {
    return new BridgeError({
      code: status === 401 ? "invalid_signature" : "forbidden",
      message:
        status === 401
          ? "The bridge rejected the signature. Check that `secret` is the same in Medusa and in the bridge, and that both clocks are right."
          : "Access to the bridge was denied (HTTP 403). With Cloudflare Access, check the service token.",
      status,
      retryable: false,
    })
  }
  return new BridgeError({ code: `http_${status}`, message: clip(`The bridge answered HTTP ${status}.`), status, retryable: false })
}

/** The bridge was not reached: DNS, TLS, refused connection, timeout. */
export function classifyNetworkError(err: unknown, timeoutMs: number): BridgeError {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError"
  if (timedOut) {
    return new BridgeError({
      code: "timeout",
      message: `No answer from the bridge within ${Math.round(timeoutMs / 1000)} s.`,
      status: 0,
      retryable: true,
    })
  }
  const cause = e?.cause?.code ? ` (${e.cause.code})` : ""
  return new BridgeError({
    code: "bridge_unreachable",
    message: clip(`The bridge cannot be reached${cause}: ${e?.cause?.message ?? e?.message ?? String(err)}`),
    status: 0,
    retryable: true,
  })
}

export interface HttpBridgeOptions {
  baseUrl: string
  secret: string
  cfAccessClientId?: string
  cfAccessClientSecret?: string
  timeoutMs: number
  contractVersion: string
  userAgent?: string
  fetch?: typeof fetch
  /** Unix seconds; tests pin the clock. */
  now?: () => number
}

export class HttpBridgeClient implements BridgeApi {
  readonly mode = "live" as const
  private readonly o: HttpBridgeOptions

  constructor(options: HttpBridgeOptions) {
    this.o = { ...options, baseUrl: options.baseUrl.replace(/\/+$/, "") }
  }

  /** One signed request. Returns the status and the parsed JSON body. */
  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const url = new URL(`${this.o.baseUrl}${path}`)
    const raw = body === undefined ? "" : JSON.stringify(body)
    const timestamp = this.o.now ? this.o.now() : Math.floor(Date.now() / 1000)
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.o.userAgent ?? "koda-medusa-subiekt-nexo",
      "X-Koda-Contract": this.o.contractVersion,
      "X-Koda-Signature": signatureHeader({
        secret: this.o.secret,
        timestamp,
        method,
        pathAndQuery: `${url.pathname}${url.search}`,
        body: raw,
      }),
    }
    if (raw) headers["Content-Type"] = "application/json"
    if (this.o.cfAccessClientId && this.o.cfAccessClientSecret) {
      headers["CF-Access-Client-Id"] = this.o.cfAccessClientId
      headers["CF-Access-Client-Secret"] = this.o.cfAccessClientSecret
    }

    const doFetch = this.o.fetch ?? fetch
    let res: Response
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: raw || undefined,
        signal: AbortSignal.timeout(this.o.timeoutMs),
        redirect: "manual",
      })
    } catch (err) {
      throw classifyNetworkError(err, this.o.timeoutMs)
    }

    const text = await res.text().catch(() => "")
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (res.status >= 300) throw classifyHttpError(res.status, json, json === null ? text.slice(0, 200) : "")
    if (json === null) {
      throw new BridgeError({ code: "invalid_response", message: `The bridge answered HTTP ${res.status} without JSON.`, status: res.status, retryable: true })
    }
    return { status: res.status, body: json as T }
  }

  async health(): Promise<BridgeHealth> {
    return (await this.request<BridgeHealth>("GET", "/v1/health")).body
  }

  async createOrder(order: ContractOrder): Promise<OrderResult> {
    const { status, body } = await this.request<OrderResult>("POST", "/v1/orders", order)
    return { ...body, created: typeof body.created === "boolean" ? body.created : status === 201 }
  }

  async getOrder(orderId: string): Promise<OrderStatusResult | null> {
    try {
      return (await this.request<OrderStatusResult>("GET", `/v1/orders/${encodeURIComponent(orderId)}`)).body
    } catch (err) {
      if (err instanceof BridgeError && err.status === 404) return null
      throw err
    }
  }

  async cancelOrder(orderId: string, reason: string | null): Promise<CancelResult> {
    return (await this.request<CancelResult>("POST", `/v1/orders/${encodeURIComponent(orderId)}/cancel`, { reason })).body
  }

  async createFulfillment(orderId: string, request: FulfillmentRequest): Promise<FulfillmentResult> {
    const { status, body } = await this.request<FulfillmentResult>("POST", `/v1/orders/${encodeURIComponent(orderId)}/fulfillments`, request)
    return { ...body, created: typeof body.created === "boolean" ? body.created : status === 201 }
  }

  async listStock(cursor: string | null, limit: number): Promise<StockPage> {
    const q = new URLSearchParams({ limit: String(limit) })
    if (cursor) q.set("cursor", cursor)
    return (await this.request<StockPage>("GET", `/v1/stock?${q.toString()}`)).body
  }

  async listEvents(after: number, limit: number): Promise<EventsPage> {
    const q = new URLSearchParams({ after: String(after), limit: String(limit) })
    return (await this.request<EventsPage>("GET", `/v1/events?${q.toString()}`)).body
  }
}

/** Short, safe description of any error for logs and the admin. */
export function describeError(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof BridgeError) return { code: err.code, message: err.message, retryable: err.retryable }
  const e = err as { code?: unknown; message?: unknown; retryable?: unknown }
  return {
    code: typeof e?.code === "string" ? e.code : "internal",
    message: clip(typeof e?.message === "string" ? e.message : String(err)),
    retryable: typeof e?.retryable === "boolean" ? e.retryable : true,
  }
}
