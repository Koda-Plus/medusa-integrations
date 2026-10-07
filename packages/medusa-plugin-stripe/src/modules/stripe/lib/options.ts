/**
 * Options of `@koda-plus/medusa-plugin-stripe`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-stripe", options: { apiKey: process.env.STRIPE_READ_KEY } }]
 *
 * Every key is optional. A missing or wrong key never breaks the boot: the
 * module registers, the admin page shows what to set up, and nothing calls
 * Stripe until a key is there. Numbers and booleans may come as strings
 * (environment variables); broken values fall back to the defaults.
 */
import {
  CHECK_KEYS,
  DEFAULT_CACHE_SECONDS,
  DEFAULT_MAX_PAGES,
  DEFAULT_PROVIDER_ID,
  DEFAULT_REQUESTS_PER_SECOND,
  DEFAULT_TIMEOUT_MS,
  DEMO_ORDER_RULES,
  MAX_CACHE_SECONDS,
  MAX_MAX_PAGES,
  MAX_REQUESTS_PER_SECOND,
  MAX_TIMEOUT_MS,
  MIN_CACHE_SECONDS,
  MIN_TIMEOUT_MS,
} from "./constants"
import type { CheckKey } from "./contract"
import { normalizeReferences, type StripeReference, type StripeReferenceOption } from "./references"

export interface StripePluginOptions {
  /**
   * The key the plugin reads Stripe with. A restricted key (`rk_live_...`)
   * with read permissions is recommended; the provider's secret key works
   * too. Never sent to the browser.
   */
  apiKey?: string
  /**
   * Sample data built from the store's own orders; Stripe is never called.
   * Only `true` turns it on (default false): a missing key on production
   * shows the setup, never sample data.
   */
  demo?: boolean | string
  /**
   * Demo mode only: which orders get a sample Stripe payment. "stripe"
   * (default): orders whose Medusa payment, or payment session when there is
   * no payment yet, belongs to a Stripe provider (pp_stripe*). "stripe-or-none":
   * also orders without any payment collection (a demo store seeded without a
   * checkout). Marketplace imports, cash on delivery and other gateways never
   * get one.
   */
  demoOrders?: "stripe" | "stripe-or-none" | string
  /** The `id` of the official Stripe provider entry in medusa-config (pp_stripe_<id>). Default "stripe". */
  providerId?: string
  /** The public address of this Medusa backend, for the webhook check. Default: the address the admin is opened on. */
  backendUrl?: string
  /** Storefront domains where the Payment Element shows Apple Pay and Google Pay. Default: the http(s) origins of STORE_CORS, localhost left out. */
  storefrontDomains?: string[] | string
  /** How long a Stripe read is reused, in seconds. Default 300 (30 to 86400). */
  cacheSeconds?: number | string
  /** Most list pages (100 objects each) one read fetches. Default 20. */
  maxPages?: number | string
  /** Requests per second the plugin allows itself. Default 10 (Stripe allows 100 in live mode, 25 in a sandbox, for the whole account). */
  requestsPerSecond?: number | string
  /** Timeout of one Stripe request in ms. Default 20000. */
  timeoutMs?: number | string
  /** Checks to run. Every check runs unless set to false, e.g. { domains: false }. */
  checks?: Partial<Record<CheckKey, boolean | string>>
  /** Stores running the integration, shown in the admin ("Running in stores built by Koda Plus"). */
  references?: StripeReferenceOption[]
}

export type DemoOrderRule = (typeof DEMO_ORDER_RULES)[number]

export interface ResolvedStripeOptions {
  apiKey: string
  demo: boolean
  demoOrders: DemoOrderRule
  providerId: string
  backendUrl: string | null
  /** Null: derive from STORE_CORS at request time. */
  storefrontDomains: string[] | null
  cacheSeconds: number
  maxPages: number
  requestsPerSecond: number
  timeoutMs: number
  checks: Record<CheckKey, boolean>
  references: StripeReference[]
}

/** true for true, "true", "1", "yes", "on"; false for false, "false", "0", "no", "off"; otherwise the fallback. */
export function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const v = value.trim().toLowerCase()
    if (["true", "1", "yes", "on"].includes(v)) return true
    if (["false", "0", "no", "off"].includes(v)) return false
  }
  return fallback
}

export function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** An http(s) base address without a trailing slash, or null. */
export function baseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const u = new URL(value.trim())
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`
  } catch {
    return null
  }
}

/** Host names from a list, a comma separated string, or URLs; anything that is not a public host name is dropped. */
export function domainList(value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") continue
    let v = item.trim().toLowerCase()
    if (!v) continue
    if (/^[a-z]+:\/\//.test(v)) {
      try {
        v = new URL(v).hostname
      } catch {
        continue
      }
    }
    v = v.replace(/:\d+$/, "").replace(/\/.*$/, "").replace(/\.$/, "")
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/**
 * Storefront domains from Medusa's STORE_CORS (`http.storeCors`): the
 * http(s) origins, without localhost, private addresses and patterns.
 */
export function domainsFromCors(storeCors: unknown): string[] {
  if (typeof storeCors !== "string") return []
  const out: string[] = []
  for (const part of storeCors.split(",")) {
    const v = part.trim()
    if (!/^https?:\/\//i.test(v) || v.startsWith("/")) continue
    let host: string
    try {
      host = new URL(v).hostname.toLowerCase()
    } catch {
      continue
    }
    if (host === "localhost" || host.endsWith(".localhost") || /^(\d+\.){3}\d+$/.test(host) || host.includes("*") || !host.includes(".")) continue
    if (!out.includes(host)) out.push(host)
  }
  return out
}

export function resolveOptions(input: StripePluginOptions | null | undefined): ResolvedStripeOptions {
  const o = (input ?? {}) as StripePluginOptions
  const providerId = typeof o.providerId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.providerId.trim()) ? o.providerId.trim() : DEFAULT_PROVIDER_ID
  const checksIn = o.checks && typeof o.checks === "object" ? o.checks : {}
  const checks = Object.fromEntries(CHECK_KEYS.map((k) => [k, bool((checksIn as Record<string, unknown>)[k], true)])) as Record<CheckKey, boolean>
  return {
    apiKey: typeof o.apiKey === "string" ? o.apiKey.trim() : "",
    /* Only an explicit true: a missing key never turns real orders into sample payments. */
    demo: bool(o.demo, false),
    demoOrders: demoOrderRule(o.demoOrders),
    providerId,
    backendUrl: baseUrl(o.backendUrl),
    storefrontDomains: domainList(o.storefrontDomains),
    cacheSeconds: int(o.cacheSeconds, DEFAULT_CACHE_SECONDS, MIN_CACHE_SECONDS, MAX_CACHE_SECONDS),
    maxPages: int(o.maxPages, DEFAULT_MAX_PAGES, 1, MAX_MAX_PAGES),
    requestsPerSecond: int(o.requestsPerSecond, DEFAULT_REQUESTS_PER_SECOND, 1, MAX_REQUESTS_PER_SECOND),
    timeoutMs: int(o.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    checks,
    references: normalizeReferences(o.references),
  }
}

/** "stripe" unless the option names another known rule. */
export function demoOrderRule(value: unknown): DemoOrderRule {
  const v = typeof value === "string" ? value.trim().toLowerCase() : ""
  return (DEMO_ORDER_RULES as readonly string[]).includes(v) ? (v as DemoOrderRule) : "stripe"
}

/** What keeps the plugin from reading Stripe. Empty in demo mode. */
export function missingOptions(o: Pick<ResolvedStripeOptions, "demo" | "apiKey">): string[] {
  return o.demo || o.apiKey ? [] : ["apiKey"]
}
