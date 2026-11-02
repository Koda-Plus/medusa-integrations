import {
  COD_CURRENCIES,
  DEFAULT_COD_COUNTRIES,
  DEFAULT_DOCUMENT_RETENTION_DAYS,
  DEFAULT_LABEL_PAGE,
  BOX_SIDE_MAX_CM,
  BOX_SIDE_MIN_CM,
  BOX_WEIGHT_MAX_KG,
  BOX_WEIGHT_MIN_KG,
  DPDSERVICES_HOSTS,
  EU_COUNTRIES,
  LABEL_PAGES,
  SHIPMENT_STAGES,
  TRACKING_MODES,
  type CodCurrency,
  type DpdMode,
  type LabelPage,
  type ShipmentStage,
  type TrackingMode,
} from "./constants"
import { resolveOrderer, resolveSender, type DpdOrdererOption, type DpdSenderOption, type ResolvedOrderer, type ResolvedSender } from "./sender"
import { WRITERS, WRITER_OPTION, type WriterKey } from "./writers"

/**
 * Options of `@koda-plus/medusa-plugin-dpd`. The SAME object goes to the
 * plugin (the data module, the admin, the routes and jobs) and to the
 * fulfillment provider:
 *
 *   const dpd = { login: process.env.DPD_LOGIN, password: process.env.DPD_PASSWORD, masterFid: process.env.DPD_MASTER_FID, ... }
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-dpd", options: dpd }]
 *   modules: [{ resolve: "@medusajs/medusa/fulfillment", options: { providers: [
 *     { resolve: "@koda-plus/medusa-plugin-dpd/providers/dpd", id: "dpd", options: dpd },
 *   ] } }]
 *
 * Every key is optional and nothing is stored in the database. Missing values
 * never break the boot: without credentials the plugin registers, says "not
 * configured" in the admin and sends nothing. Demo mode only with
 * `demo: true`. Values may come straight from environment variables:
 * booleans and numbers as strings, lists as comma separated strings or JSON
 * arrays, objects as JSON. A value that cannot be read is ignored and listed
 * in `problems`.
 */

export type DpdBoxOption = {
  /** Kilograms, 0.01 to 700. */
  weightKg?: number | string
  /** Centimetres, 1 to 300 each. */
  lengthCm?: number | string
  widthCm?: number | string
  heightCm?: number | string
}

export type DpdPluginOptions = {
  /** Simulated shipments built from the store's orders; nothing goes to DPD. Default false. */
  demo?: boolean | string
  /** "sandbox" (the DPD demo host, default) or "live" (production). Ignored in demo mode. */
  mode?: "sandbox" | "live" | string
  /** DPDServices login (HTTP Basic). Never leaves the server. */
  login?: string
  /** DPDServices password. Never leaves the server. */
  password?: string
  /** The master FID (header `x-dpd-fid`). */
  masterFid?: number | string
  /** The payer FID in the request body. Default the master FID. */
  payerFid?: number | string
  /** InfoServices (statuses): login, password and the channel DPD assigned. */
  infoLogin?: string
  infoPassword?: string
  infoChannel?: string
  /** "waybill" (default, never confirms events) or "queue" (only with a channel used by Medusa alone). */
  trackingMode?: TrackingMode | string
  /** MyPudoAPI (Pickup points): Basic credentials, preferred over the key that travels in the URL. */
  pickupLogin?: string
  pickupPassword?: string
  pickupApiKey?: string
  /** The sender of every shipment and the receiver of return labels. Object or JSON. */
  sender?: DpdSenderOption | string
  /** The orderer of a courier order; each field defaults to the sender. Object or JSON. */
  orderer?: DpdOrdererOption | string
  /** A sender per stock location id, for stores shipping from several warehouses. Object or JSON. */
  senders?: Record<string, DpdSenderOption> | string
  /** The label page by default: "A4" (default) or "LBL_PRINTER". Chosen again when printing. */
  labelPage?: LabelPage | string
  /** Destination countries (ISO alpha-2), default the EU. Countries outside the EU are not supported in v1. */
  countries?: string[] | string
  /** Cash on delivery currencies per destination country, like { "PL": ["PLN"], "CZ": ["CZK"] }. Default { "PL": ["PLN"] }. */
  codCountries?: Record<string, string[] | string> | string
  /** Payment providers that mean "pay at the door" (default ["pp_system_default"]). */
  codPaymentProviders?: string[] | string
  /** International return labels (generateReturnLabel, needs an agreement with DPD). Default false. */
  internationalReturns?: boolean | string
  /** The unit of the variant weights in Medusa: "g" (default) or "kg". */
  weightUnit?: "g" | "kg" | string
  /** The box when the variants have no weight. Object or JSON. Default none. */
  defaultBox?: DpdBoxOption | string
  /** Extra InfoServices event codes and the stage each means, like { "230402": "returned" }. Object or JSON. */
  statusMap?: Record<string, string> | string
  /** Days a stored label or protocol is kept. Default 90. */
  documentRetentionDays?: number | string
  /** With the shipment writer armed: create the shipment as soon as a fulfillment is created. Default false. */
  autoCreate?: boolean | string
  /** HARD SWITCH of the DPD writes that create parcels. Default false (true in demo mode, simulated). */
  shipmentWriter?: boolean | string
  /** HARD SWITCH of the courier orders. Default false (true in demo mode, simulated). */
  pickupWriter?: boolean | string
  /** HARD SWITCH of the Medusa writes (shipped, delivered). Default false (true in demo mode, simulated). */
  fulfillmentStatusWriter?: boolean | string
}

export type ResolvedBox = {
  weightKg: number
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
}

export type ResolvedDpdOptions = {
  demo: boolean
  mode: DpdMode
  login: string
  password: string
  masterFid: number | null
  payerFid: number | null
  infoLogin: string
  infoPassword: string
  infoChannel: string
  trackingMode: TrackingMode
  pickupLogin: string
  pickupPassword: string
  pickupApiKey: string
  sender: ResolvedSender
  orderer: ResolvedOrderer
  senders: Record<string, ResolvedSender>
  labelPage: LabelPage
  countries: string[]
  codCountries: Record<string, CodCurrency[]>
  codPaymentProviders: string[]
  internationalReturns: boolean
  weightUnit: "g" | "kg"
  defaultBox: ResolvedBox | null
  statusMap: Record<string, ShipmentStage>
  documentRetentionDays: number
  autoCreate: boolean
  writers: Record<WriterKey, boolean>
  /** Values that were set but ignored, for the admin and the boot log. */
  problems: string[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "")

const isSet = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")

/** true / false from booleans and the usual strings; null when the value says neither. */
export function boolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return null
}

/**
 * A whole number from min to max. Unset gives the fallback; a value that is
 * no number gives the fallback and a problem; a fraction is rounded down and
 * a number out of range is brought into it, each with a problem.
 */
function bounded(v: unknown, fallback: number, min: number, max: number, name: string, problems: string[]): number {
  if (!isSet(v)) return fallback
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : Number.NaN
  if (!Number.isFinite(n)) {
    problems.push(`${name} (a whole number from ${min} to ${max})`)
    return fallback
  }
  const whole = Math.floor(n)
  if (whole !== n || whole < min || whole > max) problems.push(`${name} (a whole number from ${min} to ${max})`)
  return Math.min(max, Math.max(min, whole))
}

/**
 * A list from an array, a JSON array in a string (`'["PL","DE"]'`, as an
 * environment variable may hold it) or a comma separated string, trimmed,
 * without empty and repeated values. Null when a string starts with "[" but
 * is no JSON array.
 */
export function parseTextList(v: unknown, max = 50): string[] | null {
  let items: unknown[] = []
  if (Array.isArray(v)) items = v
  else if (typeof v === "string") {
    const s = v.trim()
    if (s.startsWith("[")) {
      let parsed: unknown
      try {
        parsed = JSON.parse(s)
      } catch {
        return null
      }
      if (!Array.isArray(parsed)) return null
      items = parsed
    } else items = s.split(",")
  }
  return [...new Set(items.map((x) => str(x)).filter(Boolean))].slice(0, max)
}

/** parseTextList, with a broken JSON array read as an empty list. */
export function textList(v: unknown, max = 50): string[] {
  return parseTextList(v, max) ?? []
}

/** parseTextList for an option: a broken JSON array is a problem, and null. */
function listOption(v: unknown, max: number, name: string, problems: string[]): string[] | null {
  const list = parseTextList(v, max)
  if (list === null) problems.push(`${name} (JSON array)`)
  return list
}

/** A plain object, or the object a JSON string holds; null when there is none (and a problem when one was meant). */
export function objectOption(v: unknown, name: string, problems: string[]): Record<string, unknown> | null {
  if (!isSet(v)) return null
  let value: unknown = v
  if (typeof v === "string") {
    try {
      value = JSON.parse(v)
    } catch {
      problems.push(`${name} (JSON object)`)
      return null
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${name} (object)`)
    return null
  }
  return value as Record<string, unknown>
}

/** A DPD FID: a positive whole number that fits int32. */
export function fidOf(v: unknown): number | null {
  const s = str(v)
  if (!/^\d{1,10}$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= 2147483647 ? n : null
}

export function labelPageOf(v: unknown): LabelPage | null {
  const s = str(v).toUpperCase()
  return (LABEL_PAGES as readonly string[]).includes(s) ? (s as LabelPage) : null
}

function trackingModeOf(v: unknown): TrackingMode | null {
  const s = str(v).toLowerCase()
  return (TRACKING_MODES as readonly string[]).includes(s) ? (s as TrackingMode) : null
}

function stageOf(v: unknown): ShipmentStage | null {
  const s = str(v).toLowerCase()
  return (SHIPMENT_STAGES as readonly string[]).includes(s) ? (s as ShipmentStage) : null
}

function currencyOf(v: unknown): CodCurrency | null {
  const s = str(v).toUpperCase()
  return (COD_CURRENCIES as readonly string[]).includes(s) ? (s as CodCurrency) : null
}

const EU: readonly string[] = EU_COUNTRIES

/** The destination countries: EU members in upper case. Anything else is a problem; nothing valid left means the default. */
function resolveCountries(v: unknown, problems: string[]): string[] {
  if (!isSet(v)) return [...EU_COUNTRIES]
  const list = listOption(v, 60, "countries", problems)
  if (!list) return [...EU_COUNTRIES]
  const out: string[] = []
  for (const raw of list) {
    const c = raw.toUpperCase()
    if (!/^[A-Z]{2}$/.test(c)) problems.push(`countries.${raw} (ISO alpha-2 code)`)
    else if (!EU.includes(c)) problems.push(`countries.${c} (outside the EU, not supported)`)
    else if (!out.includes(c)) out.push(c)
  }
  if (out.length === 0) {
    problems.push("countries (no usable country, the EU is used)")
    return [...EU_COUNTRIES]
  }
  return out
}

/** Country to currencies. Invalid countries and currencies are dropped with a problem; `{}` turns cash on delivery off everywhere. */
function resolveCodCountries(v: unknown, countries: readonly string[], problems: string[]): Record<string, CodCurrency[]> {
  const obj = objectOption(v, "codCountries", problems)
  if (!obj) {
    const out: Record<string, CodCurrency[]> = {}
    for (const [country, currencies] of Object.entries(DEFAULT_COD_COUNTRIES)) if (countries.includes(country)) out[country] = [...currencies]
    return out
  }
  const out: Record<string, CodCurrency[]> = {}
  for (const [rawCountry, rawCurrencies] of Object.entries(obj)) {
    const country = rawCountry.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(country)) {
      problems.push(`codCountries.${rawCountry} (ISO alpha-2 code)`)
      continue
    }
    if (!countries.includes(country)) {
      problems.push(`codCountries.${country} (not in countries)`)
      continue
    }
    const currencies: CodCurrency[] = []
    for (const raw of listOption(rawCurrencies, 10, `codCountries.${country}`, problems) ?? []) {
      const c = currencyOf(raw)
      if (!c) problems.push(`codCountries.${country}.${raw} (PLN, EUR, RON or CZK)`)
      else if (!currencies.includes(c)) currencies.push(c)
    }
    if (currencies.length > 0) out[country] = currencies
    else problems.push(`codCountries.${country} (no usable currency)`)
  }
  return out
}

function resolveSenders(v: unknown, problems: string[]): Record<string, ResolvedSender> {
  const obj = objectOption(v, "senders", problems)
  if (!obj) return {}
  const out: Record<string, ResolvedSender> = {}
  for (const [locationId, raw] of Object.entries(obj)) {
    const id = locationId.trim()
    if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`senders.${locationId} (a sender object)`)
      continue
    }
    out[id] = resolveSender(raw)
  }
  return out
}

function decimal(v: unknown): number {
  return Number(str(v).replace(",", "."))
}

function resolveBox(v: unknown, problems: string[]): ResolvedBox | null {
  const obj = objectOption(v, "defaultBox", problems)
  if (!obj) return null
  const weight = decimal(obj.weightKg)
  if (!Number.isFinite(weight) || weight < BOX_WEIGHT_MIN_KG || weight > BOX_WEIGHT_MAX_KG) {
    problems.push(`defaultBox.weightKg (${BOX_WEIGHT_MIN_KG} to ${BOX_WEIGHT_MAX_KG})`)
    return null
  }
  const side = (key: "lengthCm" | "widthCm" | "heightCm"): number | null => {
    if (!isSet(obj[key])) return null
    const n = decimal(obj[key])
    if (!Number.isFinite(n) || n < BOX_SIDE_MIN_CM || n > BOX_SIDE_MAX_CM) {
      problems.push(`defaultBox.${key} (${BOX_SIDE_MIN_CM} to ${BOX_SIDE_MAX_CM})`)
      return null
    }
    return Math.round(n)
  }
  return { weightKg: Math.round(weight * 100) / 100, lengthCm: side("lengthCm"), widthCm: side("widthCm"), heightCm: side("heightCm") }
}

function resolveStatusMap(v: unknown, problems: string[]): Record<string, ShipmentStage> {
  const obj = objectOption(v, "statusMap", problems)
  if (!obj) return {}
  const out: Record<string, ShipmentStage> = {}
  for (const [rawCode, rawStage] of Object.entries(obj)) {
    const code = rawCode.trim()
    const stage = stageOf(rawStage)
    if (!/^[A-Za-z0-9_]{1,32}$/.test(code)) problems.push(`statusMap.${rawCode} (an event code)`)
    else if (!stage) problems.push(`statusMap.${code} (${SHIPMENT_STAGES.join(", ")})`)
    else out[code] = stage
  }
  return out
}

export function resolveOptions(o: DpdPluginOptions | undefined | null): ResolvedDpdOptions {
  const opts: DpdPluginOptions = o ?? {}
  const problems: string[] = []
  /* Demo only when asked for: missing credentials on production must never turn real fulfillments into sample rows. */
  const demoOption = boolOrNull(opts.demo)
  if (isSet(opts.demo) && demoOption === null) problems.push("demo (true or false)")
  const demo = demoOption === true
  const modeRaw = str(opts.mode).toLowerCase()
  /* The sandbox by default: production credentials against the demo host simply fail, the other way round they would create real parcels. */
  let mode: DpdMode = "sandbox"
  if (demo) mode = "demo"
  else if (modeRaw === "live") mode = "live"
  else if (modeRaw && modeRaw !== "sandbox") problems.push(modeRaw === "demo" ? "mode (demo mode needs demo: true)" : "mode (sandbox or live)")
  const writerSwitch = (v: unknown, name: string): boolean => {
    const b = boolOrNull(v)
    if (isSet(v) && b === null) problems.push(`${name} (true or false)`)
    return b ?? demo
  }
  const flag = (v: unknown, name: string): boolean => {
    const b = boolOrNull(v)
    if (isSet(v) && b === null) problems.push(`${name} (true or false)`)
    return b === true
  }
  const masterFid = fidOf(opts.masterFid)
  if (isSet(opts.masterFid) && masterFid === null) problems.push("masterFid (a whole number)")
  const payerOwn = fidOf(opts.payerFid)
  if (isSet(opts.payerFid) && payerOwn === null) problems.push("payerFid (a whole number)")
  const trackingMode = trackingModeOf(opts.trackingMode)
  if (isSet(opts.trackingMode) && !trackingMode) problems.push("trackingMode (waybill or queue)")
  const labelPage = labelPageOf(opts.labelPage)
  if (isSet(opts.labelPage) && !labelPage) problems.push("labelPage (A4 or LBL_PRINTER)")
  const unit = str(opts.weightUnit).toLowerCase()
  if (unit && unit !== "g" && unit !== "kg") problems.push("weightUnit (g or kg)")
  const senderObj = objectOption(opts.sender, "sender", problems)
  const sender = resolveSender(senderObj ?? {})
  const ordererObj = objectOption(opts.orderer, "orderer", problems)
  const countries = resolveCountries(opts.countries, problems)
  const writers = {} as Record<WriterKey, boolean>
  const writerOptions: Record<WriterKey, unknown> = { shipment: opts.shipmentWriter, pickup: opts.pickupWriter, fulfillmentStatus: opts.fulfillmentStatusWriter }
  for (const w of WRITERS) writers[w] = writerSwitch(writerOptions[w], WRITER_OPTION[w])
  return {
    demo,
    mode,
    login: str(opts.login),
    password: str(opts.password),
    masterFid,
    payerFid: payerOwn ?? masterFid,
    infoLogin: str(opts.infoLogin),
    infoPassword: str(opts.infoPassword),
    infoChannel: str(opts.infoChannel),
    trackingMode: trackingMode ?? "waybill",
    pickupLogin: str(opts.pickupLogin),
    pickupPassword: str(opts.pickupPassword),
    pickupApiKey: str(opts.pickupApiKey),
    sender,
    orderer: resolveOrderer(ordererObj ?? {}, sender),
    senders: resolveSenders(opts.senders, problems),
    labelPage: labelPage ?? DEFAULT_LABEL_PAGE,
    countries,
    codCountries: resolveCodCountries(opts.codCountries, countries, problems),
    codPaymentProviders: (isSet(opts.codPaymentProviders) ? listOption(opts.codPaymentProviders, 20, "codPaymentProviders", problems) : null) ?? ["pp_system_default"],
    internationalReturns: flag(opts.internationalReturns, "internationalReturns"),
    weightUnit: unit === "kg" ? "kg" : "g",
    defaultBox: resolveBox(opts.defaultBox, problems),
    statusMap: resolveStatusMap(opts.statusMap, problems),
    documentRetentionDays: bounded(opts.documentRetentionDays, DEFAULT_DOCUMENT_RETENTION_DAYS, 1, 3650, "documentRetentionDays", problems),
    autoCreate: flag(opts.autoCreate, "autoCreate"),
    writers,
    problems,
  }
}

/** Option names DPDServices still needs, for the admin. Empty in demo mode. */
export function missingOptions(o: ResolvedDpdOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!o.login) missing.push("login")
  if (!o.password) missing.push("password")
  if (o.masterFid === null) missing.push("masterFid")
  return missing
}

/** DPDServices can be called: sandbox or live with a login, a password and a master FID. */
export function canCallDpd(o: ResolvedDpdOptions): boolean {
  return !o.demo && missingOptions(o).length === 0
}

/** The DPDServices host of the mode; null in demo mode (nothing is called). */
export function dpdServicesHost(o: Pick<ResolvedDpdOptions, "mode">): string | null {
  return o.mode === "demo" ? null : DPDSERVICES_HOSTS[o.mode]
}

/** Every secret of the options, for masking. Logins and FIDs are identifiers, not secrets. */
export function secretsOf(o: ResolvedDpdOptions): string[] {
  return [o.password, o.infoPassword, o.pickupPassword, o.pickupApiKey].filter(Boolean)
}
