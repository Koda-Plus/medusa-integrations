import { DEFAULT_COD_PROVIDERS, DEFAULT_PREPAID_PROVIDERS, DEFAULT_TIMEOUT_MS, TAX_ID_METADATA_KEYS } from "./constants"

/**
 * Plugin options, as written in `medusa-config.ts`. Every key is optional:
 * missing credentials never break the boot, the admin says what is missing.
 */
export interface SubiektPluginOptions {
  /** Base URL of the bridge, for example `https://subiekt-bridge.example.com`. */
  bridgeUrl?: string
  /** Shared secret for request signatures, 32+ random characters. */
  secret?: string
  /** The previous secret, accepted on incoming webhooks during a rotation. */
  previousSecret?: string
  /** Cloudflare Access service token, when the bridge sits behind Access. */
  cfAccessClientId?: string
  cfAccessClientSecret?: string
  /** Simulated bridge: ZK and WZ numbers without a Subiekt installation. */
  demo?: boolean
  /** Payment providers that must be captured before the ZK is created. Prefix match. */
  prepaidProviders?: string[]
  /** Payment providers meaning cash on delivery. Prefix match. */
  codProviders?: string[]
  /** Read stock from Subiekt on schedule. */
  stockSyncEnabled?: boolean
  /** Stock location that mirrors the Subiekt warehouse. Optional when the store has one location. */
  stockLocationId?: string
  /** `quantity` (physical, default) or `available` (minus ZK reservations). */
  stockField?: "quantity" | "available"
  /** Compute stock changes and record them without writing inventory levels. */
  stockDryRun?: boolean
  /** A fulfillment created in Medusa asks the bridge for a WZ. */
  issueWzOnFulfillment?: boolean
  /** A WZ issued in Subiekt creates the fulfillment in Medusa. */
  fulfillOnWz?: boolean
  /** Read the bridge event feed (WZ issued in Subiekt). */
  eventsEnabled?: boolean
  /** SKU suffixes removed before matching, for example `["-WH"]`. */
  stripSkuSuffixes?: string[]
  /** Leave lines without EAN and SKU off the ZK instead of failing the order. */
  omitLinesWithoutCode?: boolean
  /** Order metadata keys copied into the payload for a custom bridge. */
  forwardMetadataKeys?: string[]
  /** Order metadata keys searched for the buyer's tax id. */
  taxIdMetadataKeys?: string[]
  /** Timeout of one bridge request in ms. */
  timeoutMs?: number
}

export interface ResolvedSubiektOptions {
  bridgeUrl: string
  secret: string
  previousSecret: string
  cfAccessClientId: string
  cfAccessClientSecret: string
  demo: boolean
  prepaidProviders: string[]
  codProviders: string[]
  stockSyncEnabled: boolean
  stockLocationId: string
  stockField: "quantity" | "available"
  stockDryRun: boolean
  issueWzOnFulfillment: boolean
  fulfillOnWz: boolean
  eventsEnabled: boolean
  stripSkuSuffixes: string[]
  omitLinesWithoutCode: boolean
  forwardMetadataKeys: string[]
  taxIdMetadataKeys: string[]
  timeoutMs: number
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

const list = (v: unknown, fallback: readonly string[]): string[] => {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean)
  if (typeof v === "string" && v.trim()) return v.split(",").map((x) => x.trim()).filter(Boolean)
  return [...fallback]
}

const bool = (v: unknown, fallback: boolean): boolean => {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return fallback
}

export function resolveOptions(o: SubiektPluginOptions | undefined | null): ResolvedSubiektOptions {
  const opts = o ?? {}
  const timeout = Number(opts.timeoutMs)
  return {
    bridgeUrl: str(opts.bridgeUrl).replace(/\/+$/, ""),
    secret: str(opts.secret),
    previousSecret: str(opts.previousSecret),
    cfAccessClientId: str(opts.cfAccessClientId),
    cfAccessClientSecret: str(opts.cfAccessClientSecret),
    demo: bool(opts.demo, false),
    prepaidProviders: list(opts.prepaidProviders, DEFAULT_PREPAID_PROVIDERS),
    codProviders: list(opts.codProviders, DEFAULT_COD_PROVIDERS),
    stockSyncEnabled: bool(opts.stockSyncEnabled, true),
    stockLocationId: str(opts.stockLocationId),
    stockField: opts.stockField === "available" ? "available" : "quantity",
    stockDryRun: bool(opts.stockDryRun, false),
    issueWzOnFulfillment: bool(opts.issueWzOnFulfillment, false),
    fulfillOnWz: bool(opts.fulfillOnWz, false),
    eventsEnabled: bool(opts.eventsEnabled, true),
    stripSkuSuffixes: list(opts.stripSkuSuffixes, []),
    omitLinesWithoutCode: bool(opts.omitLinesWithoutCode, false),
    forwardMetadataKeys: list(opts.forwardMetadataKeys, []),
    taxIdMetadataKeys: list(opts.taxIdMetadataKeys, TAX_ID_METADATA_KEYS),
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.min(timeout, 120_000) : DEFAULT_TIMEOUT_MS,
  }
}

/** Options without which live mode cannot talk to the bridge. */
export function missingOptions(o: ResolvedSubiektOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!/^https?:\/\/[^/\s]+/i.test(o.bridgeUrl)) missing.push("bridgeUrl")
  if (o.secret.length < 16) missing.push("secret")
  return missing
}

/** Host of the bridge for the admin, never the full URL with a path or credentials. */
export function bridgeHost(o: ResolvedSubiektOptions): string | null {
  if (o.demo || !o.bridgeUrl) return null
  try {
    return new URL(o.bridgeUrl).host
  } catch {
    return null
  }
}
