import { isValidKey } from "./crypto"
import {
  DEFAULT_BREAKER_THRESHOLD,
  DEFAULT_IMPORT_PER_RUN,
  DEFAULT_INVOICE_KINDS,
  DEFAULT_MAX_PRICE_CHANGE_PERCENT,
  DEFAULT_PRICE_CAP,
  DEFAULT_PUBLISH_CAP,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_STOCK_CAP,
  DEFAULT_TIMEOUT_MS,
  PLUGIN_VERSION,
  isAllegroEnvironment,
  type AllegroEnvironment,
} from "./constants"
import { normalizeReferences, type ReferenceInput, type ResolvedReference } from "./references"
import { WRITER_KEYS, readScopesNeeded, scopesFor as scopesForInputs, type WriterKey } from "./writers"

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
  /**
   * Keys used before `encryptionKey`, for a key rotation: stored tokens are
   * read with them and stored again under the current key. Remove them once
   * the account has refreshed its token (the status shows when).
   */
  previousEncryptionKeys?: string[]
  /** `production` (default) or `sandbox` (allegro.pl.allegrosandbox.pl, free test accounts). */
  environment?: AllegroEnvironment
  /**
   * A simulated Allegro account built from your catalog, no Allegro account
   * needed. Only when this is `true`: missing keys never switch it on.
   */
  demo?: boolean
  /** Hourly offer sync. Default true. */
  syncEnabled?: boolean
  /** Read-only order journal every ten minutes. Default true. Asks for the orders:read scope. */
  ordersEnabled?: boolean
  /** Stock locations whose quantities count in the stock check and the stock push. Default: all of them. */
  stockLocationIds?: string[]
  /** Self-imposed rate limit. Default 300 per minute (Allegro allows 9 000 per client id). */
  requestsPerMinute?: number
  timeoutMs?: number
  /**
   * Name of the app as registered in the Allegro developer portal. Allegro
   * asks for `AppName/Version (+DocsUrl)` as the User-Agent, with the name of
   * the registered app.
   */
  appName?: string
  /** Address in the User-Agent: your integration page or a contact page. */
  docsUrl?: string
  /** The whole User-Agent, when you need to set it yourself. Wins over appName. */
  userAgent?: string
  /**
   * THE HARD SWITCHES of the writers. A writer can be armed in the admin only
   * when its switch is true here; `false` cannot be overridden from the admin.
   * Default: all false in live mode. In demo mode a writer you do not mention
   * is allowed, because demo writers only touch the simulation, except the
   * order import: it creates orders in this Medusa store, so in demo mode too
   * it needs `orders: true` here.
   */
  writes?: Partial<Record<WriterKey, boolean>>
  /** Consecutive systemic failures after which a writer disarms itself. Default 5. */
  breakerThreshold?: number
  /**
   * `decrease` (default): only lowers an Allegro quantity to what Medusa has.
   * `mirror`: also raises it, and only while the order import is armed and
   * up to date, so a sale on Allegro is already in Medusa.
   */
  stockPush?: "decrease" | "mirror"
  /** Offers one stock run may change. Default 50. */
  stockPushCap?: number
  /**
   * Allegro cannot set a quantity to zero; an offer whose variant sold out in
   * Medusa can only be ended. Default true: the stock writer ends it (and
   * never activates an ended offer again). False: the plan only reports it.
   */
  endOffersAtZero?: boolean
  /** Where imported Allegro orders land in Medusa. */
  orderImport?: {
    /** Sales channel of imported orders. Default: a channel named "Allegro" if you have one, else the store default. */
    salesChannelId?: string
    /** Region of imported orders. Default: the first region in the order currency (PLN). */
    regionId?: string
    /** Shipping option put on every imported order, so it can be fulfilled without picking one. */
    shippingOptionId?: string
    /** Per Allegro delivery method (its id or its name), the Medusa shipping option to use. */
    shippingOptions?: Record<string, string>
    /** Orders one run creates at most. Default 25. */
    perRun?: number
  }
  /** Medusa fulfillment provider id (or its prefix) to Allegro carrier id, e.g. `{ "manual_manual": "OTHER" }`. */
  carriers?: Record<string, string>
  /** Document kinds of Fakturownia attached to Allegro orders. Default `["vat", "correction"]`. */
  invoiceKinds?: Array<"vat" | "correction" | "receipt" | "proforma">
  /** Price push. */
  prices?: {
    /** Read the Medusa price from this price list instead of the variant's default price. */
    priceListId?: string
    /** Variant (or product) metadata key with the lowest allowed Allegro price. Default `allegro_price_min`. */
    minKey?: string
    /** Variant (or product) metadata key with the highest allowed Allegro price. Default `allegro_price_max`. */
    maxKey?: string
    /** Refuse to change a price without a floor. Default true. */
    requireFloor?: boolean
    /** A change bigger than this percentage of the current price is refused. Default 30. */
    maxChangePercent?: number
    /** Offers one price run may change. Default 20. */
    cap?: number
    /**
     * Allegro takes gross prices. Unset: the plugin reads the Medusa price
     * preference of PLN and plans nothing while those prices exclude tax
     * (Medusa's default). `true`: your PLN prices include tax. `false`: they
     * do not, so price and draft plans are refused.
     */
    taxInclusive?: boolean
  }
  /** Publish by EAN: draft offers for variants with an EAN and no offer. */
  publish?: {
    /** Shipping rates (cennik dostawy) id or name from the Allegro seller panel. */
    shippingRatesId?: string
    /** Dispatch location. For Poland `province` is required (e.g. MAZOWIECKIE) and `postCode` is XX-XXX. */
    location?: { city: string; postCode: string; province?: string; countryCode?: string }
    /** Invoice type of new offers. Default VAT. */
    invoice?: "VAT" | "VAT_MARGIN" | "WITHOUT_VAT" | "NO_INVOICE"
    /** Drafts one run may create. Default 5. */
    cap?: number
  }
  /** Customer issues, read only. */
  issues?: {
    /** Customer returns (orders:read). Default true. */
    returns?: boolean
    /** Disputes and claims (`allegro:api:disputes`, which has no read-only variant). Default false. */
    disputes?: boolean
    /** Unread message threads (`allegro:api:messaging`, which has no read-only variant). Default false. */
    messages?: boolean
  }
  /** Stores running this integration, shown in the admin ("Running in production"). */
  references?: ReferenceInput[]
}

export interface ResolvedAllegroOptions {
  clientId: string
  clientSecret: string
  encryptionKey: string
  /** Valid previous keys only, newest first. */
  previousEncryptionKeys: string[]
  environment: AllegroEnvironment
  demo: boolean
  syncEnabled: boolean
  ordersEnabled: boolean
  stockLocationIds: string[]
  requestsPerMinute: number
  timeoutMs: number
  userAgent: string
  appName: string | null
  writes: Record<WriterKey, boolean>
  breakerThreshold: number
  stockPush: "decrease" | "mirror"
  stockPushCap: number
  endOffersAtZero: boolean
  orderImport: {
    salesChannelId: string | null
    regionId: string | null
    shippingOptionId: string | null
    shippingOptions: Record<string, string>
    perRun: number
  }
  carriers: Record<string, string>
  invoiceKinds: string[]
  prices: {
    priceListId: string | null
    minKey: string
    maxKey: string
    requireFloor: boolean
    maxChangePercent: number
    cap: number
    /** null: read from the PLN price preference in Medusa. */
    taxInclusive: boolean | null
  }
  publish: {
    shippingRatesId: string | null
    location: { city: string; postCode: string; province: string | null; countryCode: string } | null
    invoice: "VAT" | "VAT_MARGIN" | "WITHOUT_VAT" | "NO_INVOICE"
    cap: number
  }
  issues: { returns: boolean; disputes: boolean; messages: boolean }
  references: ResolvedReference[]
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

const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

const record = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim()
    const value = str(val)
    if (key && value) out[key] = value
  }
  return out
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** A User-Agent product token: no spaces, no separators Allegro's validator would reject. */
export function userAgentFor(o: { appName?: unknown; docsUrl?: unknown; userAgent?: unknown }): string {
  const custom = str(o.userAgent)
  if (custom) return custom
  const name = str(o.appName).replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "")
  const docs = /^https:\/\/\S+$/i.test(str(o.docsUrl)) ? str(o.docsUrl) : "https://koda.plus"
  return `${name || "KodaPlus-Allegro-Medusa"}/${PLUGIN_VERSION} (+${docs})`
}

const PROVINCES = new Set([
  "DOLNOSLASKIE",
  "KUJAWSKO_POMORSKIE",
  "LUBELSKIE",
  "LUBUSKIE",
  "LODZKIE",
  "MALOPOLSKIE",
  "MAZOWIECKIE",
  "OPOLSKIE",
  "PODKARPACKIE",
  "PODLASKIE",
  "POMORSKIE",
  "SLASKIE",
  "SWIETOKRZYSKIE",
  "WARMINSKO_MAZURSKIE",
  "WIELKOPOLSKIE",
  "ZACHODNIOPOMORSKIE",
])

export function resolveOptions(o: AllegroPluginOptions | undefined | null): ResolvedAllegroOptions {
  const opts = o ?? {}
  const demo = bool(opts.demo, false)
  const rpm = Number(opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE)
  const timeout = Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  /* Hard switches: false wins. Live default false; demo default true, except the order import, which creates Medusa orders. */
  const rawWrites = obj(opts.writes)
  const writes = Object.fromEntries(WRITER_KEYS.map((k) => [k, bool(rawWrites[k], demo && k !== "orders")])) as Record<WriterKey, boolean>

  const imp = obj(opts.orderImport)
  const prices = obj(opts.prices)
  const publish = obj(opts.publish)
  const location = obj(publish.location)
  const issues = obj(opts.issues)
  const kinds = list(opts.invoiceKinds)
    .map((k) => k.toLowerCase())
    .filter((k) => ["vat", "correction", "receipt", "proforma"].includes(k))

  const province = str(location.province).toUpperCase()
  const city = str(location.city)
  const postCode = str(location.postCode)
  const invoice = str(publish.invoice).toUpperCase()

  return {
    clientId: str(opts.clientId),
    clientSecret: str(opts.clientSecret),
    encryptionKey: str(opts.encryptionKey),
    previousEncryptionKeys: list(opts.previousEncryptionKeys).filter((k) => k !== str(opts.encryptionKey) && isValidKey(k)),
    environment: isAllegroEnvironment(opts.environment) ? opts.environment : "production",
    demo,
    syncEnabled: bool(opts.syncEnabled, true),
    ordersEnabled: bool(opts.ordersEnabled, true),
    stockLocationIds: list(opts.stockLocationIds),
    requestsPerMinute: Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : DEFAULT_REQUESTS_PER_MINUTE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
    userAgent: userAgentFor(opts),
    appName: str(opts.appName) || null,
    writes,
    breakerThreshold: int(opts.breakerThreshold, DEFAULT_BREAKER_THRESHOLD, 1, 100),
    stockPush: opts.stockPush === "mirror" ? "mirror" : "decrease",
    stockPushCap: int(opts.stockPushCap, DEFAULT_STOCK_CAP, 1, 10_000),
    endOffersAtZero: bool(opts.endOffersAtZero, true),
    orderImport: {
      salesChannelId: str(imp.salesChannelId) || null,
      regionId: str(imp.regionId) || null,
      shippingOptionId: str(imp.shippingOptionId) || null,
      shippingOptions: record(imp.shippingOptions),
      perRun: int(imp.perRun, DEFAULT_IMPORT_PER_RUN, 1, 500),
    },
    carriers: record(opts.carriers),
    invoiceKinds: kinds.length > 0 ? [...new Set(kinds)] : [...DEFAULT_INVOICE_KINDS],
    prices: {
      priceListId: str(prices.priceListId) || null,
      minKey: str(prices.minKey) || "allegro_price_min",
      maxKey: str(prices.maxKey) || "allegro_price_max",
      requireFloor: bool(prices.requireFloor, true),
      maxChangePercent: int(prices.maxChangePercent, DEFAULT_MAX_PRICE_CHANGE_PERCENT, 1, 1000),
      cap: int(prices.cap, DEFAULT_PRICE_CAP, 1, 10_000),
      taxInclusive: typeof prices.taxInclusive === "boolean" || typeof prices.taxInclusive === "string" ? bool(prices.taxInclusive, false) : null,
    },
    publish: {
      shippingRatesId: str(publish.shippingRatesId) || null,
      location:
        city && postCode
          ? {
              city,
              postCode,
              province: PROVINCES.has(province) ? province : null,
              countryCode: (str(location.countryCode) || "PL").toUpperCase(),
            }
          : null,
      invoice: invoice === "VAT_MARGIN" || invoice === "WITHOUT_VAT" || invoice === "NO_INVOICE" ? invoice : "VAT",
      cap: int(publish.cap, DEFAULT_PUBLISH_CAP, 1, 500),
    },
    issues: {
      returns: bool(issues.returns, true),
      disputes: bool(issues.disputes, demo),
      messages: bool(issues.messages, demo),
    },
    references: normalizeReferences(opts.references),
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

/**
 * Scopes asked for in the consent: offers, orders when the journal, an
 * order writer or the returns need them, and the write scopes of the
 * writers the options ALLOW. Disputes and messages only when switched on.
 */
export function scopesFor(o: Pick<ResolvedAllegroOptions, "ordersEnabled" | "writes" | "issues">): string {
  return scopesForInputs({ ordersEnabled: o.ordersEnabled, writes: o.writes, issues: o.issues })
}

export function readScopes(o: Pick<ResolvedAllegroOptions, "ordersEnabled" | "writes" | "issues">): string[] {
  return readScopesNeeded({ ordersEnabled: o.ordersEnabled, writes: o.writes, issues: o.issues })
}

/** Problems with the publish options, for the plan and the guide. */
export function publishProblems(o: ResolvedAllegroOptions): string[] {
  const out: string[] = []
  if (!o.publish.shippingRatesId) out.push("publish.shippingRatesId")
  if (!o.publish.location) out.push("publish.location")
  else if (o.publish.location.countryCode === "PL" && !o.publish.location.province) out.push("publish.location.province")
  return out
}
