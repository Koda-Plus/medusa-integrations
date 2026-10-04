import { isValidKey } from "./crypto"
import {
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_SKU_PATTERNS,
  DEFAULT_TIMEOUT_MS,
  isOlxMarket,
  type OlxMarket,
} from "./constants"

/**
 * Options of `@koda-plus/medusa-plugin-olx`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-olx", options: { ... } }]
 *
 * Missing credentials never break the boot: the module registers, the admin
 * says what is missing and the scheduled sync waits.
 */
export interface OlxPluginOptions {
  /** OLX app client id, from developer.olx.pl (or the developer portal of your market). */
  clientId?: string
  clientSecret?: string
  /** 32 random bytes in base64 (`openssl rand -base64 32`). Encrypts OLX tokens at rest. */
  encryptionKey?: string
  /** Must equal the redirect URI registered in the OLX app, e.g. https://api.example.com/olx/callback */
  redirectUri?: string
  /** OLX market: pl (default), ro, pt, bg, ua, kz, uz. */
  market?: OlxMarket
  /** Sample adverts generated from your catalog, no OLX account needed. */
  demo?: boolean
  /** Regex sources (one capture group) that find the SKU in advert descriptions. */
  skuPatterns?: string[]
  /** Hourly scheduled sync. Default true. */
  syncEnabled?: boolean
  /** Self-imposed rate limit. Default 200 per minute (OLX allows 4 500 per 5 minutes). */
  requestsPerMinute?: number
  timeoutMs?: number
  userAgent?: string
}

export interface ResolvedOlxOptions {
  clientId: string
  clientSecret: string
  encryptionKey: string
  redirectUri: string
  market: OlxMarket
  demo: boolean
  skuPatterns: string[]
  syncEnabled: boolean
  requestsPerMinute: number
  timeoutMs: number
  userAgent: string
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

export function resolveOptions(o: OlxPluginOptions | undefined | null): ResolvedOlxOptions {
  const opts = o ?? {}
  const patterns = Array.isArray(opts.skuPatterns)
    ? opts.skuPatterns.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : []
  const rpm = Number(opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE)
  const timeout = Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return {
    clientId: str(opts.clientId),
    clientSecret: str(opts.clientSecret),
    encryptionKey: str(opts.encryptionKey),
    redirectUri: str(opts.redirectUri),
    market: isOlxMarket(opts.market) ? opts.market : "pl",
    demo: opts.demo === true,
    skuPatterns: patterns.length > 0 ? patterns : [...DEFAULT_SKU_PATTERNS],
    syncEnabled: opts.syncEnabled !== false,
    requestsPerMinute: Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : DEFAULT_REQUESTS_PER_MINUTE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
    userAgent: str(opts.userAgent) || "KodaPlus-Medusa-OLX/0.1 (+https://koda.plus)",
  }
}

/** Option names the live mode still needs. Empty when the plugin can connect. */
export function missingOptions(o: ResolvedOlxOptions): string[] {
  const missing: string[] = []
  if (!o.clientId) missing.push("clientId")
  if (!o.clientSecret) missing.push("clientSecret")
  if (!o.encryptionKey) missing.push("encryptionKey")
  else if (!isValidKey(o.encryptionKey)) missing.push("encryptionKey (32 bytes, base64)")
  if (!o.redirectUri) missing.push("redirectUri")
  return missing
}
