/**
 * Options of `@koda-plus/medusa-plugin-inpost-marketplace`.
 *
 * NOTHING HERE THROWS. Missing options never break the boot: without the
 * credentials and without `demo` the plugin says "Not configured", every
 * route answers politely and nothing leaves the server. Switches and numbers
 * may come as strings (environment variables).
 */
/**
 * One set of credentials: the API application a seller creates in the
 * InPost Merchant Portal (Integrations, API, "Create App") with the five
 * scopes of the seller API. The plugin signs in as that application
 * (OAuth2 Client Credentials, the merchant flow) and gets a fresh access
 * token whenever the last one (five minutes) runs out.
 */
export interface VonHalskyCredentials {
  /** The application's client id. */
  clientId?: string
  /** The application's client secret, shown once in the Merchant Portal. Server only, never shown in full. */
  clientSecret?: string
  /** The organization (the seller's brand) the API paths are scoped to. */
  organizationId?: string
  /** The API gateway. Default: InPost's stage gateway for sandbox, the production one for live. */
  apiUrl?: string
  /** The OAuth2 token endpoint. Default: InPost's stage or production account service. */
  tokenUrl?: string
}

/** InPost's addresses (Integration guidelines, "Gdzie szukać wskazówek"). */
export const ENDPOINTS = {
  sandbox: { apiUrl: "https://stage-api.inpost-group.com/inpsa", tokenUrl: "https://stage-account.inpost-group.com/oauth2/token" },
  live: { apiUrl: "https://api.inpost-group.com/inpsa", tokenUrl: "https://account.inpost-group.com/oauth2/token" },
} as const

export interface VonHalskyPluginOptions {
  /**
   * Demo mode: a simulated marketplace on the store's own catalog (offers
   * get published, orders, returns and claims arrive), and nothing is ever
   * sent outside. Only on explicit request; it wins over the credentials.
   * Default false.
   */
  demo?: boolean | string
  /** Which credentials are used: "sandbox" (default) or "live". The two sets are kept apart. */
  environment?: "sandbox" | "live" | string
  sandbox?: VonHalskyCredentials
  live?: VonHalskyCredentials
  /** The channel markup over the Medusa price, in percent (-50 to 300). Default 0. The admin setting wins. */
  markupPercent?: number | string
  /** The VAT rate used when Medusa keeps PLN prices without tax (marketplace prices are gross). Default 23. */
  vatRate?: number | string
  /** Whether Medusa's PLN prices include tax. Default: read from Medusa's PLN price preference. */
  pricesIncludeTax?: boolean | string | null
  /** The sales channel of imported orders. Default: a channel named "InPost Von Halsky", else the store default. The admin setting wins. */
  salesChannelId?: string
  /** The region of imported orders (PLN). Default: the first PLN region. The admin setting wins. */
  regionId?: string
  /** Import new marketplace orders on a schedule (the sync, every 5 minutes). Default false. The admin setting wins. */
  autoImport?: boolean | string
  /**
   * WRITER: keep the price and the stock of listed offers equal to Medusa's,
   * every 5 minutes (the sync; the marketplace batch price and
   * stock updates). Default true; listing itself is always a person's click.
   */
  syncPriceStock?: boolean | string
  /** Days the store needs to ship (the offer's `shippingTime.daysToShip`, 0 to 60). Default 2. The admin setting wins. */
  daysToShip?: number | string
  /** Metadata key of a per product VAT rate (like 8 or "5%") when it is not the default `vatRate`. Default "vat_rate". */
  vatKey?: string
  /** Units of Medusa's variant dimensions: "mm" or "cm" (the marketplace takes mm). Default "mm". */
  dimensionUnit?: "mm" | "cm" | string
  /** Unit of Medusa's variant weight: "g" or "kg" (the marketplace takes grams). Default "g". */
  weightUnit?: "g" | "kg" | string
  /** Metadata key of the brand on the variant, then the product. Default "brand". */
  brandKey?: string
  /** Metadata key of the manufacturer part number on the variant, then the product. Default "mpn". */
  mpnKey?: string
  /** Metadata key of an EAN when the variant's own `ean` and `barcode` are empty. Default "ean". */
  eanKey?: string
  /** Stock locations whose quantities count; default every location. */
  stockLocationIds?: string[] | string
  /** Quantity offered for variants whose inventory Medusa does not manage. Default 0. */
  untrackedStock?: number | string
  /** Timeout of one request to the seller API in ms. Default 15000. */
  timeoutMs?: number | string
}

export type VonHalskyMode = "demo" | "sandbox" | "live" | "off"

export interface ResolvedCredentials {
  clientId: string
  clientSecret: string
  organizationId: string
  apiUrl: string
  tokenUrl: string
}

export interface ResolvedVonHalskyOptions {
  demo: boolean
  environment: "sandbox" | "live"
  credentials: ResolvedCredentials
  markupPercent: number
  vatRate: number
  pricesIncludeTax: boolean | null
  salesChannelId: string | null
  regionId: string | null
  autoImport: boolean
  syncPriceStock: boolean
  daysToShip: number
  brandKey: string
  mpnKey: string
  eanKey: string
  vatKey: string
  dimensionUnit: "mm" | "cm"
  weightUnit: "g" | "kg"
  stockLocationIds: string[]
  untrackedStock: number
  timeoutMs: number
  mode: VonHalskyMode
  /** Option values that were ignored, for the admin. */
  problems: string[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")
const bool = (v: unknown): boolean => v === true || v === "true" || v === "1"
/** A switch that is on unless it is set to something false. */
const boolOn = (v: unknown): boolean => v === undefined || v === null || v === "" || bool(v)

export function num(v: unknown, fallback: number, min: number, max: number): number {
  if (v === undefined || v === null || v === "") return fallback
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function url(v: unknown, name: string, problems: string[]): string {
  const s = str(v)
  if (!s) return ""
  if (/^https:\/\/[^\s]+$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/i.test(s)) return s.replace(/\/+$/, "")
  problems.push(`${name} (an https address)`)
  return ""
}

function key(v: unknown, fallback: string): string {
  const s = str(v)
  return /^[A-Za-z0-9_.-]{1,64}$/.test(s) ? s : fallback
}

function ids(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []
  return list.map((x) => str(x)).filter((x) => /^[A-Za-z0-9_]{1,64}$/.test(x))
}

function credentials(v: unknown, name: "sandbox" | "live", problems: string[]): ResolvedCredentials {
  const o = (v && typeof v === "object" ? v : {}) as VonHalskyCredentials
  return {
    clientId: str(o.clientId),
    clientSecret: str(o.clientSecret),
    organizationId: str(o.organizationId),
    apiUrl: url(o.apiUrl, `${name}.apiUrl`, problems) || ENDPOINTS[name].apiUrl,
    tokenUrl: url(o.tokenUrl, `${name}.tokenUrl`, problems) || ENDPOINTS[name].tokenUrl,
  }
}

export function complete(c: ResolvedCredentials): boolean {
  return Boolean(c.clientId && c.clientSecret && c.organizationId && c.apiUrl && c.tokenUrl)
}

export function resolveOptions(input: VonHalskyPluginOptions | undefined | null): ResolvedVonHalskyOptions {
  const o = (input && typeof input === "object" ? input : {}) as VonHalskyPluginOptions
  const problems: string[] = []
  const demo = bool(o.demo)
  const envRaw = str(o.environment).toLowerCase()
  if (envRaw && envRaw !== "sandbox" && envRaw !== "live") problems.push("environment (sandbox or live)")
  const environment = envRaw === "live" ? "live" : "sandbox"
  const sandbox = credentials(o.sandbox, "sandbox", problems)
  const live = credentials(o.live, "live", problems)
  const creds = environment === "live" ? live : sandbox
  const include = o.pricesIncludeTax === undefined || o.pricesIncludeTax === null || o.pricesIncludeTax === "" ? null : bool(o.pricesIncludeTax)
  const channel = str(o.salesChannelId)
  const region = str(o.regionId)
  const dim = str(o.dimensionUnit).toLowerCase()
  const weight = str(o.weightUnit).toLowerCase()
  if (dim && dim !== "mm" && dim !== "cm") problems.push("dimensionUnit (mm or cm)")
  if (weight && weight !== "g" && weight !== "kg") problems.push("weightUnit (g or kg)")
  return {
    demo,
    environment,
    credentials: creds,
    markupPercent: num(o.markupPercent, 0, -50, 300),
    vatRate: num(o.vatRate, 23, 0, 100),
    pricesIncludeTax: include,
    salesChannelId: /^sc_[A-Za-z0-9]+$/.test(channel) ? channel : null,
    regionId: /^reg_[A-Za-z0-9]+$/.test(region) ? region : null,
    autoImport: bool(o.autoImport),
    syncPriceStock: boolOn(o.syncPriceStock),
    daysToShip: Math.round(num(o.daysToShip, 2, 0, 60)),
    brandKey: key(o.brandKey, "brand"),
    mpnKey: key(o.mpnKey, "mpn"),
    eanKey: key(o.eanKey, "ean"),
    vatKey: key(o.vatKey, "vat_rate"),
    dimensionUnit: dim === "cm" ? "cm" : "mm",
    weightUnit: weight === "kg" ? "kg" : "g",
    stockLocationIds: ids(o.stockLocationIds),
    untrackedStock: Math.round(num(o.untrackedStock, 0, 0, 100_000)),
    timeoutMs: Math.round(num(o.timeoutMs, 15_000, 1_000, 60_000)),
    mode: demo ? "demo" : complete(creds) ? environment : "off",
    problems: [
      ...problems,
      ...(channel && !/^sc_[A-Za-z0-9]+$/.test(channel) ? ["salesChannelId (a sales channel id like sc_...)"] : []),
      ...(region && !/^reg_[A-Za-z0-9]+$/.test(region) ? ["regionId (a region id like reg_...)"] : []),
    ],
  }
}

/** Whether the plugin works at all: credentials (sandbox or live) or demo mode. */
export function isActive(o: Pick<ResolvedVonHalskyOptions, "mode">): boolean {
  return o.mode !== "off"
}

/** Whether calls would go to the marketplace (sandbox or live). */
export function callsMarketplace(o: Pick<ResolvedVonHalskyOptions, "mode">): boolean {
  return o.mode === "live" || o.mode === "sandbox"
}

/** Options sandbox and live still need; the admin lists them. Demo needs none. */
export function missingOptions(o: ResolvedVonHalskyOptions): string[] {
  if (o.demo) return []
  const prefix = o.environment
  const missing: string[] = []
  if (!o.credentials.clientId) missing.push(`${prefix}.clientId`)
  if (!o.credentials.clientSecret) missing.push(`${prefix}.clientSecret`)
  if (!o.credentials.organizationId) missing.push(`${prefix}.organizationId`)
  return missing
}

/** "***" and the last four characters, for the admin. */
export function mask(value: string): string {
  if (!value) return ""
  return value.length <= 8 ? "***" : `***${value.slice(-4)}`
}
