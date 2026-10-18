/**
 * Options of `@koda-plus/medusa-plugin-inpost-marketplace`.
 *
 * NOTHING HERE THROWS. Missing options never break the boot: without the
 * credentials and without `demo` the plugin says "Not configured", every
 * route answers politely and nothing leaves the server. Switches and numbers
 * may come as strings (environment variables).
 */
export interface VonHalskyCredentials {
  /** The seller API base address InPost gives the integrator. No default: this version ships no address of its own. */
  apiUrl?: string
  /** The organization (seller account) id the API paths are scoped to. */
  organizationId?: string
  /** The access token (a JWT) InPost issues under the integrator agreement. Server only, never shown in full. */
  accessToken?: string
}

export interface VonHalskyPluginOptions {
  /**
   * Demo mode: offers, orders and tracking run on the store's own catalog
   * and orders, and nothing is ever sent outside. Only on explicit request;
   * it wins over the credentials. Default false.
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
  /** Import new marketplace orders on a schedule (every 15 minutes). Default false. The admin setting wins. */
  autoImport?: boolean | string
  /** WRITER: send tracking numbers back to the marketplace. Default false; demo records them locally. */
  sendTracking?: boolean | string
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
  apiUrl: string
  organizationId: string
  accessToken: string
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
  sendTracking: boolean
  brandKey: string
  mpnKey: string
  eanKey: string
  stockLocationIds: string[]
  untrackedStock: number
  timeoutMs: number
  mode: VonHalskyMode
  /** Option values that were ignored, for the admin. */
  problems: string[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")
const bool = (v: unknown): boolean => v === true || v === "true" || v === "1"

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

function credentials(v: unknown, name: string, problems: string[]): ResolvedCredentials {
  const o = (v && typeof v === "object" ? v : {}) as VonHalskyCredentials
  return { apiUrl: url(o.apiUrl, `${name}.apiUrl`, problems), organizationId: str(o.organizationId), accessToken: str(o.accessToken) }
}

export function complete(c: ResolvedCredentials): boolean {
  return Boolean(c.apiUrl && c.organizationId && c.accessToken)
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
    sendTracking: bool(o.sendTracking),
    brandKey: key(o.brandKey, "brand"),
    mpnKey: key(o.mpnKey, "mpn"),
    eanKey: key(o.eanKey, "ean"),
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
  if (!o.credentials.apiUrl) missing.push(`${prefix}.apiUrl`)
  if (!o.credentials.organizationId) missing.push(`${prefix}.organizationId`)
  if (!o.credentials.accessToken) missing.push(`${prefix}.accessToken`)
  return missing
}

/** "***" and the last four characters, for the admin. */
export function mask(value: string): string {
  if (!value) return ""
  return value.length <= 8 ? "***" : `***${value.slice(-4)}`
}
