import { isValidKey } from "./crypto"
import {
  DEFAULT_MAX_LIFECYCLE_PER_RUN,
  DEFAULT_MAX_PRICE_CHANGE_PERCENT,
  DEFAULT_MAX_PRICE_PER_RUN,
  DEFAULT_MAX_PUBLISH_PER_RUN,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_SKU_PATTERNS,
  DEFAULT_STATS_PER_RUN,
  DEFAULT_TIMEOUT_MS,
  isOlxMarket,
  type OlxMarket,
  type WriterKey,
} from "./constants"
import { normalizeReferences, type OlxReference, type OlxReferenceOption } from "./references"

/**
 * Options of `@koda-plus/medusa-plugin-olx`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-olx", options: { ... } }]
 *
 * Missing credentials never break the boot: the module registers, the admin
 * says what is missing and the scheduled jobs wait. Broken values fall back
 * to defaults instead of throwing.
 */

/** One Medusa product category mapped to one OLX category (a leaf). */
export interface OlxPublishCategoryOption {
  /** Medusa product category id (pcat_...) or handle. */
  medusaCategory: string
  /** OLX category id, a leaf of the OLX category tree. */
  olxCategoryId: number
  /** Default attribute values for this category, e.g. { state: "new" }. */
  attributes?: Record<string, string | string[]>
}

export interface OlxPublishOptions {
  categories?: OlxPublishCategoryOption[]
  /** Attribute values used for every category (a category mapping overrides them). */
  attributes?: Record<string, string | string[]>
  /** Where the adverts are located. `cityId` from `GET /cities` or `GET /locations`. */
  location?: { cityId?: number; districtId?: number; latitude?: number; longitude?: number }
  /** Contact shown on the advert. The name is required by OLX, the phone is optional. */
  contact?: { name?: string; phone?: string }
  /** Default `business`: the OLX API terms are for business use. */
  advertiserType?: "business" | "private"
  /** Appended to every description, e.g. delivery and returns in two sentences. */
  descriptionFooter?: string
}

export interface OlxPluginOptions {
  /** OLX app client id, from developer.olx.pl (or the developer portal of your market). */
  clientId?: string
  clientSecret?: string
  /** 32 random bytes in base64 (`openssl rand -base64 32`). Encrypts OLX tokens at rest. */
  encryptionKey?: string
  /** Must equal a callback URL registered in the OLX app, e.g. https://api.example.com/olx/callback */
  redirectUri?: string
  /** OLX market: pl (default), ro, pt, bg, ua, kz, uz. */
  market?: OlxMarket
  /** Sample data generated from your catalog, no OLX account needed. */
  demo?: boolean
  /** Regex sources (one capture group) that find the SKU in advert descriptions. */
  skuPatterns?: string[]
  /** Hourly scheduled sync. Default true. */
  syncEnabled?: boolean
  /** Self-imposed rate limit. Default 200 per minute (OLX allows 4 500 per 5 minutes per IP). */
  requestsPerMinute?: number
  timeoutMs?: number
  userAgent?: string
  /** Stores running the plugin, shown on the OLX page and in the setup guide. */
  references?: OlxReferenceOption[]
  /** Count stock only at the stock locations of this sales channel. Default: every location. */
  salesChannelId?: string
  /** Hourly statistics refresh (views, phone views, observers). Default true. */
  statsEnabled?: boolean
  /** Adverts whose statistics one run refreshes. Default 200. */
  statsPerRun?: number
  /** Unread message threads, read every 15 minutes. Default true. */
  messagesEnabled?: boolean
  /**
   * WRITERS, hard switches. Default false in live mode (true in demo mode,
   * where they only act on the simulation). `false` wins: the admin cannot
   * arm a writer this option turns off.
   */
  lifecycleWriter?: boolean
  priceWriter?: boolean
  publishWriter?: boolean
  /** Caps of one writer run. */
  maxLifecycleActionsPerRun?: number
  maxPriceUpdatesPerRun?: number
  maxPublishPerRun?: number
  /** `is_success` sent with `deactivate` (whether the item was sold through OLX). Default false. */
  deactivateAsSold?: boolean
  /** Price changes larger than this percent wait for a person. Default 50. */
  maxPriceChangePercent?: number
  /** Publishing from Medusa: categories, location, contact. */
  publish?: OlxPublishOptions
}

export interface ResolvedPublishCategory {
  medusaCategory: string
  olxCategoryId: number
  attributes: Record<string, string | string[]>
}

export interface ResolvedPublishOptions {
  categories: ResolvedPublishCategory[]
  attributes: Record<string, string | string[]>
  location: { cityId: number; districtId: number | null; latitude: number | null; longitude: number | null } | null
  contact: { name: string; phone: string | null } | null
  advertiserType: "business" | "private"
  descriptionFooter: string
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
  references: OlxReference[]
  salesChannelId: string | null
  statsEnabled: boolean
  statsPerRun: number
  messagesEnabled: boolean
  /** Hard switches after the demo default. */
  writers: Record<WriterKey, boolean>
  caps: Record<WriterKey, number>
  deactivateAsSold: boolean
  maxPriceChangePercent: number
  publish: ResolvedPublishOptions
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function positiveId(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

function finite(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Attribute values: strings or lists of strings, keyed by attribute code. Anything else is dropped. */
export function attributeValues(v: unknown): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const [code, value] of Object.entries(v as Record<string, unknown>)) {
    const key = code.trim()
    if (!key) continue
    if (typeof value === "string" || typeof value === "number") {
      const s = String(value).trim()
      if (s) out[key] = s
    } else if (Array.isArray(value)) {
      const list = value.filter((x) => typeof x === "string" || typeof x === "number").map((x) => String(x).trim()).filter(Boolean)
      if (list.length > 0) out[key] = list
    }
  }
  return out
}

function resolvePublish(p: OlxPublishOptions | undefined): ResolvedPublishOptions {
  const o = p && typeof p === "object" ? p : {}
  const categories: ResolvedPublishCategory[] = []
  if (Array.isArray(o.categories)) {
    for (const c of o.categories) {
      if (!c || typeof c !== "object") continue
      const medusaCategory = str(c.medusaCategory)
      const olxCategoryId = positiveId(c.olxCategoryId)
      if (!medusaCategory || !olxCategoryId) continue
      categories.push({ medusaCategory, olxCategoryId, attributes: attributeValues(c.attributes) })
    }
  }
  const cityId = positiveId(o.location?.cityId)
  const name = str(o.contact?.name)
  return {
    categories,
    attributes: attributeValues(o.attributes),
    location: cityId
      ? {
          cityId,
          districtId: positiveId(o.location?.districtId),
          latitude: finite(o.location?.latitude),
          longitude: finite(o.location?.longitude),
        }
      : null,
    contact: name ? { name: name.slice(0, 100), phone: str(o.contact?.phone) || null } : null,
    advertiserType: o.advertiserType === "private" ? "private" : "business",
    descriptionFooter: str(o.descriptionFooter).slice(0, 2000),
  }
}

/** A hard switch: explicit true allows; in demo mode anything but explicit false allows. */
function writerSwitch(value: unknown, demo: boolean): boolean {
  if (value === false) return false
  if (value === true) return true
  return demo
}

export function resolveOptions(o: OlxPluginOptions | undefined | null): ResolvedOlxOptions {
  const opts = o ?? {}
  const patterns = Array.isArray(opts.skuPatterns)
    ? opts.skuPatterns.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : []
  const rpm = Number(opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE)
  const timeout = Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const demo = opts.demo === true
  return {
    clientId: str(opts.clientId),
    clientSecret: str(opts.clientSecret),
    encryptionKey: str(opts.encryptionKey),
    redirectUri: str(opts.redirectUri),
    market: isOlxMarket(opts.market) ? opts.market : "pl",
    demo,
    skuPatterns: patterns.length > 0 ? patterns : [...DEFAULT_SKU_PATTERNS],
    syncEnabled: opts.syncEnabled !== false,
    requestsPerMinute: Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : DEFAULT_REQUESTS_PER_MINUTE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
    userAgent: str(opts.userAgent) || "KodaPlus-Medusa-OLX/0.2 (+https://koda.plus)",
    references: normalizeReferences(opts.references),
    salesChannelId: str(opts.salesChannelId) || null,
    statsEnabled: opts.statsEnabled !== false,
    statsPerRun: int(opts.statsPerRun, DEFAULT_STATS_PER_RUN, 1, 2000),
    messagesEnabled: opts.messagesEnabled !== false,
    writers: {
      lifecycle: writerSwitch(opts.lifecycleWriter, demo),
      price: writerSwitch(opts.priceWriter, demo),
      publish: writerSwitch(opts.publishWriter, demo),
    },
    caps: {
      lifecycle: int(opts.maxLifecycleActionsPerRun, DEFAULT_MAX_LIFECYCLE_PER_RUN, 1, 500),
      price: int(opts.maxPriceUpdatesPerRun, DEFAULT_MAX_PRICE_PER_RUN, 1, 500),
      publish: int(opts.maxPublishPerRun, DEFAULT_MAX_PUBLISH_PER_RUN, 1, 100),
    },
    deactivateAsSold: opts.deactivateAsSold === true,
    maxPriceChangePercent: int(opts.maxPriceChangePercent, DEFAULT_MAX_PRICE_CHANGE_PERCENT, 1, 1000),
    publish: resolvePublish(opts.publish),
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

/** Whether any writer may ever be armed, so the consent asks for the `write` scope. */
export function wantsWriteScope(o: ResolvedOlxOptions): boolean {
  return o.writers.lifecycle || o.writers.price || o.writers.publish
}
