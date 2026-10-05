import {
  DEFAULT_COD_PROVIDERS,
  DEFAULT_MAX_PRICE_CHANGES_PER_RUN,
  DEFAULT_MAX_PRODUCTS_PER_RUN,
  DEFAULT_NIP_SOURCES,
  DEFAULT_PREPAID_PROVIDERS,
  DEFAULT_TIMEOUT_MS,
  TAX_ID_METADATA_KEYS,
} from "./constants"
import { normalizeReferences, type ReferenceDto } from "./references"

export type SalesDocumentOption = "none" | "fs" | "pa" | "auto"
export type PriceTarget = "variant" | "price_list"

/**
 * Plugin options, as written in `medusa-config.ts`. Every key is optional:
 * missing credentials never break the boot, the admin says what is missing.
 *
 * WRITES ARE OFF BY DEFAULT. Every write added in 0.2.0 (prices, new
 * products, sales documents, new contractors) needs its option here AND a
 * person arming its writer in the admin. An option set to false wins: the
 * admin cannot override it. In demo mode the options default to on, because
 * the writers only touch the simulation there.
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

  /* ---------------------------- 0.2.0 ---------------------------- */

  /** Read products and prices from the bridge every hour and plan price changes. Read only. Default true. */
  productSyncEnabled?: boolean
  /** Where planned prices go: the variant's own price (`variant`, default) or a price list (`price_list`). */
  priceTarget?: PriceTarget
  /** The price list for `priceTarget: "price_list"`, for example `plist_01J...`. */
  priceListId?: string
  /** Subiekt price level (symbol or name) the prices come from. Default: the first level the bridge publishes. */
  priceLevel?: string
  /** `gross` (default, VAT included, what Medusa usually stores) or `net`. */
  priceType?: "gross" | "net"
  /** Currency of the prices written, default `pln`. */
  priceCurrency?: string
  /** HARD SWITCH of the price writer. Default false (true in demo mode). */
  priceWriter?: boolean
  /** Price changes applied in one run at most. Default 200. */
  maxPriceChangesPerRun?: number
  /** HARD SWITCH of the product creator: Subiekt products marked for the online shop and missing in Medusa become draft products. Default false (true in demo mode). */
  createMissingProducts?: boolean
  /** Products created in one run at most. Default 20. */
  maxProductsPerRun?: number
  /** Where to look for the buyer's NIP: `metadata.<key>`, `billing_address.metadata.<key>`, `billing_address.<field>`. */
  nipSources?: string[]
  /** HARD SWITCH: ask the bridge to create a contractor that is missing in Subiekt. Default false (true in demo mode). */
  createContractors?: boolean
  /** Sales document of an order: `none` (default), `fs`, `pa`, or `auto` (FS with a valid NIP, PA otherwise). The hard switch of the document writer. */
  salesDocument?: SalesDocumentOption
  /** When the sales document is issued: after the WZ (`wz`, default: the goods left) or right after the ZK (`zk`). */
  salesDocumentAfter?: "wz" | "zk"
  /** Stores that run this integration in production, shown in the admin. See the README. */
  references?: unknown[]
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
  productSyncEnabled: boolean
  priceTarget: PriceTarget
  priceListId: string
  priceLevel: string
  priceType: "gross" | "net"
  priceCurrency: string
  priceWriter: boolean
  maxPriceChangesPerRun: number
  createMissingProducts: boolean
  maxProductsPerRun: number
  nipSources: string[]
  createContractors: boolean
  salesDocument: SalesDocumentOption
  salesDocumentAfter: "wz" | "zk"
  references: ReferenceDto[]
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

const count = (v: unknown, fallback: number, max: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback
}

export function resolveOptions(o: SubiektPluginOptions | undefined | null): ResolvedSubiektOptions {
  const opts = o ?? {}
  const timeout = Number(opts.timeoutMs)
  const demo = bool(opts.demo, false)
  const taxIdMetadataKeys = list(opts.taxIdMetadataKeys, TAX_ID_METADATA_KEYS)
  const salesDocument = (["none", "fs", "pa", "auto"] as const).find((k) => k === str(opts.salesDocument).toLowerCase())
  return {
    bridgeUrl: str(opts.bridgeUrl).replace(/\/+$/, ""),
    secret: str(opts.secret),
    previousSecret: str(opts.previousSecret),
    cfAccessClientId: str(opts.cfAccessClientId),
    cfAccessClientSecret: str(opts.cfAccessClientSecret),
    demo,
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
    taxIdMetadataKeys,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.min(timeout, 120_000) : DEFAULT_TIMEOUT_MS,
    productSyncEnabled: bool(opts.productSyncEnabled, true),
    priceTarget: opts.priceTarget === "price_list" ? "price_list" : "variant",
    priceListId: str(opts.priceListId),
    priceLevel: str(opts.priceLevel),
    priceType: opts.priceType === "net" ? "net" : "gross",
    priceCurrency: (str(opts.priceCurrency) || "pln").toLowerCase(),
    priceWriter: bool(opts.priceWriter, demo),
    maxPriceChangesPerRun: count(opts.maxPriceChangesPerRun, DEFAULT_MAX_PRICE_CHANGES_PER_RUN, 5000),
    createMissingProducts: bool(opts.createMissingProducts, demo),
    maxProductsPerRun: count(opts.maxProductsPerRun, DEFAULT_MAX_PRODUCTS_PER_RUN, 500),
    nipSources: Array.isArray(opts.nipSources) || typeof opts.nipSources === "string"
      ? list(opts.nipSources, [])
      : opts.taxIdMetadataKeys !== undefined
        ? [...taxIdMetadataKeys.map((k) => `metadata.${k}`), ...taxIdMetadataKeys.map((k) => `billing_address.metadata.${k}`), "billing_address.company"]
        : [...DEFAULT_NIP_SOURCES],
    createContractors: bool(opts.createContractors, demo),
    salesDocument: salesDocument ?? (demo ? "auto" : "none"),
    salesDocumentAfter: str(opts.salesDocumentAfter).toLowerCase() === "zk" ? "zk" : "wz",
    references: normalizeReferences(opts.references),
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

/** Option problems that do not stop the plugin but stop one feature, for the admin. */
export function optionWarnings(o: ResolvedSubiektOptions): string[] {
  const warnings: string[] = []
  if (o.priceTarget === "price_list" && !/^plist_/.test(o.priceListId)) warnings.push("priceListId")
  return warnings
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
