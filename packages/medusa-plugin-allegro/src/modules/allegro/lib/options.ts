import { isValidKey } from "./crypto"
import {
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_TIMEOUT_MS,
  OFFERS_SCOPE,
  ORDERS_SCOPE,
  isAllegroEnvironment,
  type AllegroEnvironment,
} from "./constants"

/**
 * Options of `@koda-plus/medusa-plugin-allegro`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-allegro", options: { ... } }]
 *
 * Missing credentials never break the boot: the module registers, the admin
 * says what is missing and the scheduled jobs wait.
 */
export interface AllegroPluginOptions {
  /**
   * Client id of an app registered at apps.developer.allegro.pl (or the
   * sandbox portal) as a device app: "without access to a browser". The
   * device flow needs no redirect URI.
   */
  clientId?: string
  clientSecret?: string
  /** 32 random bytes in base64 (`openssl rand -base64 32`). Encrypts Allegro tokens at rest. */
  encryptionKey?: string
  /** `production` (default) or `sandbox` (allegro.pl.allegrosandbox.pl, free test accounts). */
  environment?: AllegroEnvironment
  /** Sample offers and orders generated from your catalog, no Allegro account needed. */
  demo?: boolean
  /** Hourly offer sync. Default true. */
  syncEnabled?: boolean
  /** Order journal every ten minutes. Default true. Asks for the orders:read scope. */
  ordersEnabled?: boolean
  /** Stock locations whose quantities count in the stock check. Default: all of them. */
  stockLocationIds?: string[]
  /** Self-imposed rate limit. Default 300 per minute (Allegro allows 9 000 per client id). */
  requestsPerMinute?: number
  timeoutMs?: number
  userAgent?: string
}

export interface ResolvedAllegroOptions {
  clientId: string
  clientSecret: string
  encryptionKey: string
  environment: AllegroEnvironment
  demo: boolean
  syncEnabled: boolean
  ordersEnabled: boolean
  stockLocationIds: string[]
  requestsPerMinute: number
  timeoutMs: number
  userAgent: string
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

const bool = (v: unknown, fallback: boolean): boolean => {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return fallback
}

const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean)
  if (typeof v === "string" && v.trim()) return v.split(",").map((x) => x.trim()).filter(Boolean)
  return []
}

export function resolveOptions(o: AllegroPluginOptions | undefined | null): ResolvedAllegroOptions {
  const opts = o ?? {}
  const rpm = Number(opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE)
  const timeout = Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return {
    clientId: str(opts.clientId),
    clientSecret: str(opts.clientSecret),
    encryptionKey: str(opts.encryptionKey),
    environment: isAllegroEnvironment(opts.environment) ? opts.environment : "production",
    demo: bool(opts.demo, false),
    syncEnabled: bool(opts.syncEnabled, true),
    ordersEnabled: bool(opts.ordersEnabled, true),
    stockLocationIds: list(opts.stockLocationIds),
    requestsPerMinute: Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : DEFAULT_REQUESTS_PER_MINUTE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
    userAgent: str(opts.userAgent) || "KodaPlus-Medusa-Allegro/0.1 (+https://koda.plus)",
  }
}

/** Option names the live mode still needs. Empty when the plugin can connect. */
export function missingOptions(o: ResolvedAllegroOptions): string[] {
  const missing: string[] = []
  if (!o.clientId) missing.push("clientId")
  if (!o.clientSecret) missing.push("clientSecret")
  if (!o.encryptionKey) missing.push("encryptionKey")
  else if (!isValidKey(o.encryptionKey)) missing.push("encryptionKey (32 bytes, base64)")
  return missing
}

/** Scopes asked for in the consent: offers, plus orders when the journal is on. Read only. */
export function scopesFor(o: Pick<ResolvedAllegroOptions, "ordersEnabled">): string {
  return [OFFERS_SCOPE, ...(o.ordersEnabled ? [ORDERS_SCOPE] : [])].join(" ")
}
