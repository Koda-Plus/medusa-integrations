import {
  EU_COUNTRIES,
  LOCKER_TYPES,
  MYPUDO_PATHS,
  MYPUDO_URL,
  PICKUP_MAX_KG,
  POINT_BOX_LIMITS,
  POINT_SERVICES,
  POINTS_COORD_DECIMALS,
  POINTS_MAX_RESULTS,
  PUDO_ID_PATTERN,
  SERVICE_COD,
  SERVICE_DELIVERY,
  ZABKA_TYPE,
} from "./constants"
import type { PointDto, PointHoursDto, PointLimitsDto } from "./contract"
import type { LoggerLike } from "./dpdservices"
import type { PickupAuth } from "./options"
import { maskSecrets } from "./security"

/**
 * THE MYPUDO CLIENT: the only code that talks to MyPudoAPI v2 (DPD Pickup
 * points), GET only, one call per search or point, never retried.
 *
 *   auth      HTTP Basic (pickupLogin, pickupPassword) or the pickupApiKey in
 *             the URL (`key=`, always last); without either nothing is
 *             called and every answer is not_configured
 *   secrets   every URL, message and log line goes through maskSecrets; a
 *             URL is never logged unmasked and never leaves this file
 *   answers   normalized to the small PointDto of contract.ts; an entry the
 *             parser does not know is dropped, never read as a point without
 *             services (fail open at checkout, spec 8.2)
 *
 * Every parameter name and answer shape here comes from the PDF only [NZ]:
 * MyPudo has no test host and was never called. PARAM_NAMES is the one
 * place to switch a name.
 */

export type MyPudoFailure = "not_configured" | "timeout" | "network" | "http" | "invalid_answer" | "api_error"

export type MyPudoList = { ok: true; points: PointDto[] } | { ok: false; reason: MyPudoFailure; message: string }
export type MyPudoOne = { ok: true; point: PointDto } | { ok: false; reason: "not_found" | MyPudoFailure; message: string }

export type MyPudoSearch =
  | { by: "address"; country: string; zip: string; city?: string; address?: string; limit: number }
  | { by: "coords"; lat: number; lng: number; radiusM: number; limit: number }

export type MyPudoClientOptions = {
  /** MYPUDO_URL by default. */
  baseUrl?: string
  auth: PickupAuth
  timeoutMs: number
  fetchImpl?: typeof fetch
  /** secretsOf(options), for maskSecrets. */
  secrets: readonly string[]
  logger?: LoggerLike
  /** Tests; default: "kp" + base36 time + counter, alphanumeric, at most 30 characters. */
  requestId?: () => string
}

export type MyPudoClient = {
  search(q: MyPudoSearch): Promise<MyPudoList>
  details(pudoId: string): Promise<MyPudoOne>
}

/** The one place for the camelCase / snake_case split (9.2). */
export const PARAM_NAMES: {
  readonly requestId: "requestID"
  readonly key: "key"
  readonly countryCode: "countryCode"
  readonly zipCode: "zipCode"
  readonly city: "city"
  readonly address: "address"
  readonly latitude: "latitude"
  readonly longitude: "longitude"
  readonly maxDistance: "max_distance_search"
  readonly serviceDisplay: "servicePudo_display"
  readonly maxResults: "maxPudoNumber"
  readonly pudoId: "pudoId"
} = {
  requestId: "requestID",
  key: "key",
  countryCode: "countryCode",
  zipCode: "zipCode",
  city: "city",
  address: "address",
  latitude: "latitude",
  longitude: "longitude",
  maxDistance: "max_distance_search",
  serviceDisplay: "servicePudo_display",
  maxResults: "maxPudoNumber",
  pudoId: "pudoId",
}

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : ""
}

/** Builds the URL of a call (exported for the tests; the key is in it only with auth.kind "key"). */
export function myPudoUrl(path: string, params: Record<string, string>, auth: PickupAuth, baseUrl: string = MYPUDO_URL): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  const query = new URLSearchParams(params)
  /* The key goes last: a URL cut in a log line loses it first. */
  if (auth.kind === "key") query.append(PARAM_NAMES.key, auth.key)
  return `${base}${path.replace(/^\/+/, "")}?${query.toString()}`
}

/**
 * Both error shapes [MP s.5, s.9, s.35]; null when the body is not an error.
 * notFound: shape 1 with code "601"; shape 2 (no numeric code) when a userMessage
 * matches /nie znaleziono pudo/i (the 601 text of MP s.35). [NZ]
 * auth: shape 1 with code "314" or "327" (key wrong or missing).
 */
export function parseMyPudoError(body: unknown): { code: string; message: string; notFound: boolean; auth: boolean } | null {
  const b = obj(body)
  if (!b) return null
  /* Shape 2: { errors: [{ code: "REQUEST", subcode, userMessage }] }, no numeric code. */
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const first = obj(b.errors[0]) ?? {}
    const message = text(first.userMessage) || text(first.message)
    const code = [text(first.code), text(first.subcode)].filter(Boolean).join("/") || "REQUEST"
    return { code, message, notFound: /nie znaleziono pudo/i.test(message), auth: false }
  }
  /* Shape 1: { code: "327", message }. An answer with points is never an error. */
  if (b.pudoItems === undefined && (typeof b.code === "string" || typeof b.code === "number") && text(b.code) !== "") {
    const code = text(b.code)
    return { code, message: text(b.message), notFound: code === "601", auth: code === "314" || code === "327" }
  }
  return null
}

/** The items of an answer: body.pudoItems as an array, or the single array inside it ({ pudoItem: [...] }). [NZ] */
export function pudoItemsOf(body: unknown): unknown[] | null {
  const items = obj(body)?.pudoItems
  if (Array.isArray(items)) return items
  const holder = obj(items)
  if (!holder) return null
  const arrays = Object.values(holder).filter((v): v is unknown[] => Array.isArray(v))
  return arrays.length === 1 ? arrays[0] : null
}

/** EU_COUNTRIES alpha-2 to alpha-3 ("PL" to "POL"). */
export const ALPHA3: Readonly<Record<string, string>> = {
  AT: "AUT", BE: "BEL", BG: "BGR", CY: "CYP", CZ: "CZE", DE: "DEU", DK: "DNK", EE: "EST", ES: "ESP",
  FI: "FIN", FR: "FRA", GR: "GRC", HR: "HRV", HU: "HUN", IE: "IRL", IT: "ITA", LT: "LTU", LU: "LUX",
  LV: "LVA", MT: "MLT", NL: "NLD", PL: "POL", PT: "PRT", RO: "ROU", SE: "SWE", SI: "SVN", SK: "SVK",
}

const EU: readonly string[] = EU_COUNTRIES

export function toAlpha3(alpha2: string): string | null {
  return ALPHA3[String(alpha2 ?? "").trim().toUpperCase()] ?? null
}

export function toAlpha2(alpha3: string): string | null {
  const want = String(alpha3 ?? "").trim().toUpperCase()
  for (const [a2, a3] of Object.entries(ALPHA3)) if (a3 === want) return a2
  return null
}

/** The country of a raw point: alpha-3 through toAlpha2, or alpha-2 when it is one of EU_COUNTRIES [MP s.9]. */
export function countryOfRaw(v: unknown): string | null {
  const s = text(v).toUpperCase()
  if (s.length === 3) return toAlpha2(s)
  if (s.length === 2 && EU.includes(s)) return s
  return null
}

export function isLockerType(type: string): boolean {
  return LOCKER_TYPES.includes(type)
}

/** Limits from type, partner and country (5.1.1 POINT_BOX_LIMITS, PICKUP_MAX_KG). */
export function limitsOf(type: string, partner: string | null, country: string): PointLimitsDto {
  if (isLockerType(type)) {
    const [a, b, c] = POINT_BOX_LIMITS.locker.sidesCm
    return { maxKg: PICKUP_MAX_KG, box: { kind: "fits", sidesCm: [a, b, c] } }
  }
  if (type === ZABKA_TYPE || /żabka|zabka/i.test(partner ?? "")) {
    const [a, b, c] = POINT_BOX_LIMITS.zabka.sidesCm
    return { maxKg: PICKUP_MAX_KG, box: { kind: "fits", sidesCm: [a, b, c] } }
  }
  if (country !== "PL") {
    const { maxLengthCm, maxGirthCm } = POINT_BOX_LIMITS.abroad
    return { maxKg: PICKUP_MAX_KG, box: { kind: "girth", maxLengthCm, maxGirthCm } }
  }
  const { maxSideCm, maxSumCm } = POINT_BOX_LIMITS.regular
  return { maxKg: PICKUP_MAX_KG, box: { kind: "sum", maxSideCm, maxSumCm } }
}

/** Haversine distance in whole metres (the one implementation; points.ts distanceM uses it). */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))))
}

/** true, "true", "1", 1 and false, "false", "0", 0; null for anything else (the entry is then dropped, E17). */
function activeOf(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "true" || v === "1") return true
  if (v === false || v === 0 || v === "false" || v === "0") return false
  return null
}

/** A number from a number or a numeric string ("52.227"); null for an empty value or anything else. */
function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v !== "string" || v.trim() === "") return null
  const n = Number(v.trim().replace(",", "."))
  return Number.isFinite(n) ? n : null
}

const KNOWN_SERVICES: readonly string[] = POINT_SERVICES

/** servicePudo "100;101;200" or an array: known codes only, once each, sorted; null when the field is absent. */
function servicesOf(v: unknown): string[] | null {
  let parts: unknown[]
  if (typeof v === "string") parts = v.split(";")
  else if (Array.isArray(v)) parts = v
  else return null
  const codes = new Set(parts.map((p) => text(p)).filter((p) => KNOWN_SERVICES.includes(p)))
  return [...codes].sort()
}

/** "8:00", "08:00" and "08:00:00" as "08:00"; null for anything else. */
function hhmm(v: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text(v))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59) return null
  return `${String(h).padStart(2, "0")}:${m[2]}`
}

const DAYS: readonly PointHoursDto["day"][] = [1, 2, 3, 4, 5, 6, 7]

/** openingHoursItems: dayId 1 (Monday) to 7, several ranges of one day as several entries [MP s.7]; wrong entries skipped. */
function hoursOf(v: unknown): PointHoursDto[] {
  const out: PointHoursDto[] = []
  for (const raw of Array.isArray(v) ? v : []) {
    const item = obj(raw)
    const n = numberOf(item?.dayId)
    const day = DAYS.find((d) => d === n)
    const from = hhmm(item?.startTm)
    const to = hhmm(item?.endTm)
    if (day === undefined || from === null || to === null) continue
    out.push({ day, from, to })
  }
  return out.sort((a, b) => a.day - b.day || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** Digits of a postal code; five digits in Poland as NN-NNN. */
function zipOf(v: unknown, country: string): string {
  const digits = text(v).replace(/\D/g, "")
  return country === "PL" && digits.length === 5 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits
}

/**
 * One pudoItems entry to the DTO; null when id, name, address1, city or the
 * country is missing or not known, and when the entry has no servicePudo or no
 * active field at all (an absent field means the answer is not the one the
 * parser knows, not a point without services: 8.2, E17).
 */
export function normalizePudoItem(raw: unknown): PointDto | null {
  const r = obj(raw)
  if (!r) return null
  const id = text(r.pudoId).toUpperCase()
  const name = text(r.name) || text(r.Name)
  const line1 = text(r.address1)
  const city = text(r.city)
  const country = countryOfRaw(r.country)
  const active = activeOf(r.active)
  const services = servicesOf(r.servicePudo)
  if (!PUDO_ID_PATTERN.test(id) || !name || !line1 || !city || country === null || active === null || services === null) return null
  const type = r.pudoType === undefined || r.pudoType === null ? "" : text(r.pudoType)
  const partner = text(r.partner) || null
  const line2 = [text(r.address2), text(r.address3)].filter(Boolean).join(" ") || null
  const distance = numberOf(r.distance)
  return {
    id,
    name,
    type,
    isLocker: isLockerType(type),
    partner,
    address: { line1, line2, zip: zipOf(r.zipCode ?? r.zipcode, country), city, country },
    lat: numberOf(r.latitude),
    lng: numberOf(r.longitude),
    active,
    services,
    delivery: services.includes(SERVICE_DELIVERY),
    cod: services.includes(SERVICE_COD),
    hours: hoursOf(r.openingHoursItems),
    distance: distance === null ? null : Math.round(distance),
    limits: limitsOf(type, partner, country),
  }
}

/** The fields of a catalog point (demo, sandbox, tests); the rest is derived as normalizePudoItem derives it. */
export type CatalogPointInput = {
  id: string
  name: string
  type: string
  partner?: string | null
  line1: string
  line2?: string | null
  zip: string
  city: string
  country?: string
  lat?: number | null
  lng?: number | null
  active: boolean
  services: readonly string[]
  hours?: readonly PointHoursDto[]
}

/** A PointDto of a fixed catalog, with isLocker, delivery, cod and limits worked out like a MyPudo point. */
export function catalogPoint(p: CatalogPointInput): PointDto {
  const country = p.country ?? "PL"
  const partner = p.partner ?? null
  const services = [...new Set(p.services.filter((c) => KNOWN_SERVICES.includes(c)))].sort()
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    isLocker: isLockerType(p.type),
    partner,
    address: { line1: p.line1, line2: p.line2 ?? null, zip: p.zip, city: p.city, country },
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    active: p.active,
    services,
    delivery: services.includes(SERVICE_DELIVERY),
    cod: services.includes(SERVICE_COD),
    hours: (p.hours ?? []).map((h) => ({ ...h })),
    distance: null,
    limits: limitsOf(p.type, partner, country),
  }
}

/** Monday to Friday (or to `lastDay`, 7 for every day), one range each (catalog points). */
export function weekdayHours(from: string, to: string, lastDay = 5): PointHoursDto[] {
  return DAYS.filter((d) => d <= lastDay).map((day) => ({ day, from, to }))
}

function isAbort(err: unknown): boolean {
  const name = err !== null && typeof err === "object" ? (err as { name?: unknown }).name : undefined
  return name === "AbortError" || name === "TimeoutError"
}

let counter = 0

/** "kp" + base36 time + a counter: alphanumeric, at most 30 characters (requestID, error 313 [MP s.34]). */
function defaultRequestId(): string {
  counter = (counter + 1) % 1_679_616
  return `kp${Date.now().toString(36)}${counter.toString(36)}`.slice(0, 30)
}

type Op = "search" | "details"

/** What one call gave before it is read as a list or as one point. */
type Raw = { kind: "items"; points: PointDto[] } | { kind: "not_found" } | { kind: "failed"; reason: MyPudoFailure; message: string }

export function createMyPudoClient(opts: MyPudoClientOptions): MyPudoClient {
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const nextId = opts.requestId ?? defaultRequestId
  const secrets = [...opts.secrets, ...(opts.auth.kind === "key" ? [opts.auth.key] : [])]
  /* No URL in any text: the key may be in it, and a URL never leaves this file. */
  const mask = (s: string) => maskSecrets(s.replace(/https?:\/\/\S+/gi, "<url>"), secrets)

  function failed(op: Op, reason: MyPudoFailure, message: string, level: "warn" | "error" = "warn"): Raw {
    const line = mask(`[dpd] MyPudo ${op}: ${reason}. ${message}`)
    if (level === "error") opts.logger?.error(line)
    else opts.logger?.warn(line)
    return { kind: "failed", reason, message: mask(message) }
  }

  /** One GET, never retried, read body first, then the HTTP status (spec 8.2). */
  async function call(op: Op, path: string, params: Record<string, string>): Promise<Raw> {
    if (opts.auth.kind === "none") return { kind: "failed", reason: "not_configured", message: "MyPudo is not configured (pickupLogin and pickupPassword, or pickupApiKey)." }
    const url = myPudoUrl(path, { [PARAM_NAMES.requestId]: nextId(), ...params }, opts.auth, opts.baseUrl)
    const headers: Record<string, string> = { accept: "application/json" }
    if (opts.auth.kind === "basic") headers.authorization = opts.auth.header
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs)
    let status: number
    let raw: string
    try {
      const res = await doFetch(url, { method: "GET", headers, signal: ctrl.signal })
      status = res.status
      raw = await res.text()
    } catch (err) {
      if (ctrl.signal.aborted || isAbort(err)) return failed(op, "timeout", `MyPudo did not answer within ${opts.timeoutMs} ms.`)
      const why = err instanceof Error ? err.message : String(err)
      return failed(op, "network", `MyPudo could not be reached: ${why || "network error"}.`)
    } finally {
      clearTimeout(timer)
    }
    let body: unknown = null
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw)
      } catch {
        /* a gateway page: read by the HTTP status */
      }
    }
    const error = parseMyPudoError(body)
    if (error?.notFound) return { kind: "not_found" }
    /* An auth error logs error (E24) whatever the body says: the code of the body (314, 327) or the HTTP status (401, 403). */
    const denied = status === 401 || status === 403
    /* Only the code goes to a text: a MyPudo message may echo the zip or the city a customer typed. */
    if (error?.auth || (error && denied)) return failed(op, "api_error", `MyPudo refused the login or the key (code ${error.code}, HTTP ${status}).`, "error")
    if (error) return failed(op, "api_error", `MyPudo refused the call (code ${error.code}, HTTP ${status}).`)
    if (denied) return failed(op, "api_error", `MyPudo refused the login or the key (HTTP ${status}).`, "error")
    if (status < 200 || status >= 300) return failed(op, "http", `MyPudo answered HTTP ${status}.`)
    const items = pudoItemsOf(body)
    if (items === null) return failed(op, "invalid_answer", "MyPudo answered without a list of points.")
    if (items.length === 0) return { kind: "items", points: [] }
    const points = items.map((i) => normalizePudoItem(i)).filter((p): p is PointDto => p !== null)
    if (points.length === 0) return failed(op, "invalid_answer", `None of the ${items.length} points of the answer could be read.`)
    if (points.length < items.length) opts.logger?.warn(`[dpd] MyPudo ${op}: ${items.length - points.length} of ${items.length} points dropped (an answer the parser does not know).`)
    return { kind: "items", points }
  }

  async function search(q: MyPudoSearch): Promise<MyPudoList> {
    const limit = Math.max(1, Math.min(POINTS_MAX_RESULTS, Math.floor(q.limit)))
    let raw: Raw
    if (q.by === "address") {
      const country = toAlpha3(q.country)
      /* 9.4: a country outside the map has no points to ask for. */
      if (country === null) return { ok: true, points: [] }
      const params: Record<string, string> = { [PARAM_NAMES.countryCode]: country, [PARAM_NAMES.zipCode]: q.zip.replace(/\D/g, "") }
      if (q.city) params[PARAM_NAMES.city] = q.city
      if (q.address) params[PARAM_NAMES.address] = q.address
      params[PARAM_NAMES.serviceDisplay] = "1"
      params[PARAM_NAMES.maxResults] = String(limit)
      raw = await call("search", MYPUDO_PATHS.byAddress, params)
    } else {
      raw = await call("search", MYPUDO_PATHS.byLongLat, {
        [PARAM_NAMES.latitude]: q.lat.toFixed(POINTS_COORD_DECIMALS),
        [PARAM_NAMES.longitude]: q.lng.toFixed(POINTS_COORD_DECIMALS),
        [PARAM_NAMES.maxDistance]: String(Math.round(q.radiusM)),
        [PARAM_NAMES.serviceDisplay]: "1",
      })
    }
    if (raw.kind === "failed") return { ok: false, reason: raw.reason, message: raw.message }
    if (raw.kind === "not_found") return { ok: true, points: [] }
    let points = raw.points
    if (q.by === "coords") {
      /* The PDF example of bylonglat has no distance [MP s.22]: measured here when it is missing. */
      const from = { lat: q.lat, lng: q.lng }
      points = points
        .map((p) => (p.distance === null && p.lat !== null && p.lng !== null ? { ...p, distance: haversineM(from, { lat: p.lat, lng: p.lng }) } : p))
        .sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY))
    }
    return { ok: true, points: points.slice(0, limit) }
  }

  async function details(pudoId: string): Promise<MyPudoOne> {
    const id = String(pudoId ?? "").replace(/\s+/g, "").toUpperCase()
    const raw = await call("details", MYPUDO_PATHS.details, { [PARAM_NAMES.pudoId]: id, [PARAM_NAMES.serviceDisplay]: "1" })
    if (raw.kind === "failed") return { ok: false, reason: raw.reason, message: raw.message }
    if (raw.kind === "not_found" || raw.points.length === 0) return { ok: false, reason: "not_found", message: `MyPudo has no point ${id}.` }
    /* E27: only the point asked for; another id means the answer is not the one the parser knows. */
    const point = raw.points.find((p) => p.id === id)
    if (!point) {
      opts.logger?.warn(`[dpd] MyPudo details: invalid_answer. The answer for ${id} holds another point.`)
      return { ok: false, reason: "invalid_answer", message: `MyPudo answered another point for ${id}.` }
    }
    return { ok: true, point }
  }

  /* The client never throws: anything unexpected is a network failure, like a fetch that threw. */
  return {
    search: async (q) => {
      try {
        return await search(q)
      } catch (err) {
        return { ok: false, reason: "network", message: mask(`MyPudo search failed: ${err instanceof Error ? err.message : String(err)}.`) }
      }
    },
    details: async (pudoId) => {
      try {
        return await details(pudoId)
      } catch (err) {
        return { ok: false, reason: "network", message: mask(`MyPudo details failed: ${err instanceof Error ? err.message : String(err)}.`) }
      }
    },
  }
}
