import type { SigningKey } from "./signature"

/**
 * THE BASKET APP API CLIENT (InPost's side, called by the store), for the
 * sandbox and for production. Paths as the "InPost Pay (Basket App)" page of
 * the merchant documentation lists them:
 *
 *   PUT    /v2/izi/basket/{basket_id}/binding    a binding key for Widget 2.0 (idempotent)
 *   PUT    /v2/izi/basket/{basket_id}            the basket changed in the store
 *   GET    /v1/izi/basket/{basket_id}/binding    is the basket linked to the app
 *   DELETE /v1/izi/basket/{basket_id}/binding    unlink the basket from the phone
 *   POST   /v1/izi/order/{order_id}/event        the order changed in the store
 *   GET    /v1/izi/signing-keys/public/{version} the key InPost signs its calls with
 *
 * Authorization: OAuth 2.0 client credentials against InPost's login
 * (`grant_type=client_credentials`), the token reused until `expires_in`.
 *
 * Not settled by the pages that could be read (said here instead of
 * guessed): the request body of the binding call (documented as "none", so
 * none is sent), the exact prefix of the signing key path (the page shows
 * both `/v1/izi/...` and `/basket-app/api/v1/izi/...`; the first is used, the
 * `apiUrl` option can add a prefix), the response of the order event.
 */

export type ApiErrorKind = "auth" | "invalid" | "not_found" | "rate" | "unavailable" | "error"

export class InpostPayApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind
  constructor(status: number, kind: ApiErrorKind, message: string) {
    super(message)
    this.name = "InpostPayApiError"
    this.status = status
    this.kind = kind
  }
}

export interface OrderEventInput {
  event_id: string
  event_data_time: string
  phone_number?: { country_prefix: string; phone: string }
  event_data: {
    order_status?: "ORDER_COMPLETED" | "ORDER_REJECTED"
    order_merchant_status_description?: string
    delivery_references_list?: string[]
  }
}

export interface BasketAppClient {
  readonly mode: "live" | "sandbox" | "demo"
  /** A token (live) or a fixed word (demo); proves the keys work. */
  check(): Promise<{ ok: true; expiresIn: number | null }>
  bind(basketId: string): Promise<{ basket_binding_api_key: string }>
  updateBasket(basketId: string, basket: Record<string, unknown>): Promise<void>
  bindingStatus(basketId: string): Promise<Record<string, unknown>>
  unbind(basketId: string): Promise<void>
  orderEvent(orderId: string, event: OrderEventInput): Promise<Record<string, unknown>>
  signingKey(version: string): Promise<SigningKey>
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>

export interface ClientConfig {
  mode: "live" | "sandbox"
  apiUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  timeoutMs: number
  /** Injected in tests; the global fetch otherwise. */
  fetch?: FetchLike
}

/** Secrets out of any text that may reach a log or the admin. */
export function maskSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("***")
  return out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***").replace(/("?(access_token|client_secret)"?\s*[:=]\s*"?)[^",&\s]+/gi, "$1***")
}

function kindOf(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return "auth"
  if (status === 404) return "not_found"
  if (status === 429) return "rate"
  if (status >= 500) return "unavailable"
  if (status >= 400) return "invalid"
  return "error"
}

const enc = encodeURIComponent

export function createBasketAppClient(config: ClientConfig): BasketAppClient {
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>)
  const secrets = [config.clientSecret]
  let token: { value: string; until: number } | null = null

  async function call(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; json: any }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const res = await doFetch(url, { ...init, signal: controller.signal })
      const text = await res.text()
      let json: any = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      if (!res.ok) {
        const detail = json && typeof json === "object" ? String(json.error_message ?? json.error_description ?? json.message ?? json.error ?? "") : text.slice(0, 200)
        throw new InpostPayApiError(res.status, kindOf(res.status), maskSecrets(`InPost answered ${res.status}${detail ? `: ${detail}` : ""}`, secrets))
      }
      return { status: res.status, json }
    } catch (e) {
      if (e instanceof InpostPayApiError) throw e
      const aborted = (e as { name?: string })?.name === "AbortError"
      throw new InpostPayApiError(0, "unavailable", aborted ? `InPost did not answer within ${config.timeoutMs} ms` : maskSecrets(`InPost could not be reached: ${(e as Error)?.message ?? e}`, secrets))
    } finally {
      clearTimeout(timer)
    }
  }

  async function accessToken(): Promise<{ value: string; expiresIn: number | null }> {
    if (token && Date.now() < token.until) return { value: token.value, expiresIn: Math.round((token.until - Date.now()) / 1000) }
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }).toString()
    const { json } = await call(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body })
    const value = typeof json?.access_token === "string" ? json.access_token : ""
    if (!value) throw new InpostPayApiError(401, "auth", "InPost gave no access token")
    const expiresIn = Number(json?.expires_in)
    /* Renew 30 s early; a token without expires_in is used for a minute. */
    token = { value, until: Date.now() + Math.max(10, (Number.isFinite(expiresIn) ? expiresIn : 60) - 30) * 1000 }
    return { value, expiresIn: Number.isFinite(expiresIn) ? expiresIn : null }
  }

  async function api(method: string, path: string, body?: unknown): Promise<any> {
    const { value } = await accessToken()
    const headers: Record<string, string> = { Authorization: `Bearer ${value}`, Accept: "application/json" }
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const { json } = await call(`${config.apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return json
  }

  return {
    mode: config.mode,
    async check() {
      const t = await accessToken()
      return { ok: true, expiresIn: t.expiresIn }
    },
    async bind(basketId) {
      const json = await api("PUT", `/v2/izi/basket/${enc(basketId)}/binding`)
      const key = typeof json?.basket_binding_api_key === "string" ? json.basket_binding_api_key : ""
      if (!key) throw new InpostPayApiError(502, "error", "InPost gave no basket_binding_api_key")
      return { basket_binding_api_key: key }
    },
    async updateBasket(basketId, basket) {
      await api("PUT", `/v2/izi/basket/${enc(basketId)}`, basket)
    },
    async bindingStatus(basketId) {
      return ((await api("GET", `/v1/izi/basket/${enc(basketId)}/binding`)) ?? {}) as Record<string, unknown>
    },
    async unbind(basketId) {
      await api("DELETE", `/v1/izi/basket/${enc(basketId)}/binding`)
    },
    async orderEvent(orderId, event) {
      return ((await api("POST", `/v1/izi/order/${enc(orderId)}/event`, event)) ?? {}) as Record<string, unknown>
    },
    async signingKey(version) {
      const json = await api("GET", `/v1/izi/signing-keys/public/${enc(version)}`)
      const key = typeof json?.public_key_base64 === "string" ? json.public_key_base64 : ""
      const merchant = typeof json?.merchant_external_id === "string" ? json.merchant_external_id : String(json?.merchant_external_id ?? "")
      if (!key) throw new InpostPayApiError(502, "error", "InPost gave no public_key_base64")
      return { public_key_base64: key, merchant_external_id: merchant }
    },
  }
}
