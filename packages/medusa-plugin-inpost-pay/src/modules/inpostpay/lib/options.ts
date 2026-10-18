import { DEFAULT_PROVIDER_ID, INPOST_URLS } from "./constants"

/**
 * Options of `@koda-plus/medusa-plugin-inpost-pay`. The same object goes to
 * the plugin and to its payment provider.
 *
 * NOTHING HERE THROWS. Missing options never break the boot: without the
 * keys and without `demo` the plugin says "Not configured", every route
 * answers politely and nothing reaches InPost. Switches and numbers may come
 * as strings (environment variables).
 */
export interface InpostPayPluginOptions {
  /** OAuth client id of the Basket App API (InPost merchant portal; sandbox keys come from InPost). Server only. */
  clientId?: string
  /** OAuth client secret of the Basket App API. Server only, never shown in full. */
  clientSecret?: string
  /** The Merchant Client Id the widget is initialised with. Public: the storefront reads it. */
  merchantClientId?: string
  /** The POS id from the merchant portal. Kept for the admin; this version sends it nowhere. */
  posId?: string
  /** Use InPost's sandbox (sandbox-api, sandbox-login, the sandbox widget). Default false. */
  sandbox?: boolean | string
  /** Override of the Basket App API base URL. Default: api.inpost.pl or sandbox-api.inpost.pl. */
  apiUrl?: string
  /** Override of the OAuth token URL. */
  tokenUrl?: string
  /** Override of the widget script URL the storefront loads. */
  widgetUrl?: string
  /** The public backend address, for the Merchant API URL shown in the setup guide. Default: the address of the admin request. */
  backendUrl?: string
  /** The public storefront address, for product links in the basket the app shows. */
  storefrontUrl?: string
  /** The payment provider id the orders are paid with. Default `pp_inpost-pay_inpost-pay`. */
  paymentProviderId?: string
  /** Hours a basket stays in the app (`basket_expiration_date`). Default 24, 1 to 720. */
  basketTtlHours?: number | string
  /** The VAT rate of the shipping price shown in the app, in percent. Default 23. */
  shippingVatRate?: number | string
  /** Timeout of one request to InPost in ms. Default 15000. */
  timeoutMs?: number | string
  /**
   * WRITER: tell InPost when an order is canceled (ORDER_REJECTED) or shipped
   * (the parcel numbers). Off by default; simulated in demo mode.
   */
  sendOrderEvents?: boolean | string
  /** A stable secret for the payment session proofs; default derived from `clientSecret`. */
  sessionSecret?: string
  /**
   * Demo mode: baskets are bound in memory, the storefront confirms them with
   * a simulated app confirmation, and InPost is never called. Only on
   * explicit request; it wins over the keys. Default false.
   */
  demo?: boolean | string
}

export type InpostPayMode = "demo" | "sandbox" | "live" | "off"

export interface ResolvedInpostPayOptions {
  clientId: string
  clientSecret: string
  merchantClientId: string
  posId: string
  sandbox: boolean
  apiUrl: string
  tokenUrl: string
  widgetUrl: string
  backendUrl: string | null
  storefrontUrl: string | null
  paymentProviderId: string
  basketTtlHours: number
  shippingVatRate: number
  timeoutMs: number
  sendOrderEvents: boolean
  sessionSecret: string
  demo: boolean
  mode: InpostPayMode
  /** Option values that were ignored, for the admin. */
  problems: string[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")
const bool = (v: unknown): boolean => v === true || v === "true" || v === "1"

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (v === undefined || v === null || v === "") return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function url(v: unknown, name: string, problems: string[]): string | null {
  const s = str(v)
  if (!s) return null
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s.replace(/\/+$/, "")
  problems.push(`${name} (an http(s) address)`)
  return null
}

export function resolveOptions(input: InpostPayPluginOptions | undefined | null): ResolvedInpostPayOptions {
  const o = (input && typeof input === "object" ? input : {}) as InpostPayPluginOptions
  const problems: string[] = []
  const demo = bool(o.demo)
  const sandbox = bool(o.sandbox)
  const urls = sandbox ? INPOST_URLS.sandbox : INPOST_URLS.live
  const clientId = str(o.clientId)
  const clientSecret = str(o.clientSecret)
  const merchantClientId = str(o.merchantClientId)
  const providerId = str(o.paymentProviderId)
  if (providerId && !/^pp_[A-Za-z0-9_-]+$/.test(providerId)) problems.push("paymentProviderId (a payment provider id like pp_inpost-pay_inpost-pay)")
  const keys = Boolean(clientId && clientSecret && merchantClientId)
  return {
    clientId,
    clientSecret,
    merchantClientId,
    posId: str(o.posId),
    sandbox,
    apiUrl: url(o.apiUrl, "apiUrl", problems) ?? urls.api,
    tokenUrl: url(o.tokenUrl, "tokenUrl", problems) ?? urls.token,
    widgetUrl: url(o.widgetUrl, "widgetUrl", problems) ?? urls.widget,
    backendUrl: url(o.backendUrl, "backendUrl", problems),
    storefrontUrl: url(o.storefrontUrl, "storefrontUrl", problems),
    paymentProviderId: providerId && /^pp_[A-Za-z0-9_-]+$/.test(providerId) ? providerId : DEFAULT_PROVIDER_ID,
    basketTtlHours: Math.round(num(o.basketTtlHours, 24, 1, 720)),
    shippingVatRate: num(o.shippingVatRate, 23, 0, 100),
    timeoutMs: Math.round(num(o.timeoutMs, 15_000, 1_000, 60_000)),
    sendOrderEvents: bool(o.sendOrderEvents),
    sessionSecret: str(o.sessionSecret),
    demo,
    mode: demo ? "demo" : keys ? (sandbox ? "sandbox" : "live") : "off",
    problems,
  }
}

/** Whether the plugin works: the keys (sandbox or live), or demo mode. */
export function isActive(o: Pick<ResolvedInpostPayOptions, "mode">): boolean {
  return o.mode !== "off"
}

/** Whether calls go to InPost (sandbox or live). */
export function callsInpost(o: Pick<ResolvedInpostPayOptions, "mode">): boolean {
  return o.mode === "live" || o.mode === "sandbox"
}

/** Options sandbox and live still need; the admin lists them. Demo needs none. */
export function missingOptions(o: ResolvedInpostPayOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!o.clientId) missing.push("clientId")
  if (!o.clientSecret) missing.push("clientSecret")
  if (!o.merchantClientId) missing.push("merchantClientId")
  return missing
}

/** "***" and the last four characters, for the admin. */
export function mask(value: string): string {
  if (!value) return ""
  return value.length <= 4 ? "***" : `***${value.slice(-4)}`
}
