import { SHIPX_HOSTS } from "./constants"
import { isLockerCode, normalizeLockerCode } from "./lockers"

/**
 * PARCEL LOCKERS AND POINTS, from the PUBLIC points API of ShipX
 * (GET /v1/points, no token). Used by the admin locker search, by the store
 * route GET /store/inpost/points and by the checkout check of a locker code.
 *
 * What a search becomes (tried against the API in October 2026):
 *
 *   "KRA01M", "kra01m"      name=KRA01M (exact code)
 *   "30-415", "30415"       relative_post_code=30-415, nearest first
 *   lat and lng             relative_point=lat,lng, nearest first
 *   "Kraków", "kraków"      city=Kraków (the API matches the city exactly)
 *
 * Points come back in one small shape (`PointDto`); nothing else of the API
 * answer reaches the storefront. Searches are cached for ten minutes and a
 * locker check for an hour, so a busy checkout does not ask InPost every time.
 */

export interface PointDto {
  code: string
  name: string
  type: string[]
  status: string | null
  address: { line1: string; line2: string; street: string; building_number: string; city: string; post_code: string; province: string }
  location: { lat: number; lng: number } | null
  description: string | null
  opening_hours: string | null
  is_24_7: boolean
  /** The point takes card payments (InPost's own field), relevant for cash on delivery. */
  payment_available: boolean
  /** Metres from the searched place, when the search had one. */
  distance: number | null
}

export interface PointsQuery {
  q?: string | null
  lat?: number | null
  lng?: number | null
  limit?: number | null
  /** Only parcel lockers (default), or every collection point (PaczkoPunkty too). */
  type?: "locker" | "any" | null
  /** Points where the customer can pay at collection. */
  cod?: boolean | null
}

export type SearchMode = "code" | "postcode" | "near" | "city"

const FIELDS = "name,display_name,type,status,location,location_description,opening_hours,address,address_details,location_247,payment_available,distance,functions"

const str = (v: unknown, max = 200): string => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "")

/** "kraków" becomes "Kraków", "bielsko-biała" becomes "Bielsko-Biała" (the API matches the city as written). */
export function cityCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => (/^\s+$|^-$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("")
}

/** The API query of a search, or an error code when there is nothing to search for. */
export function pointsParams(input: PointsQuery): { params: URLSearchParams; mode: SearchMode } | { error: "query_missing" | "query_invalid" } {
  const params = new URLSearchParams()
  const limit = Math.min(25, Math.max(1, Math.floor(Number(input.limit ?? 10) || 10)))
  params.set("per_page", String(limit))
  params.set("fields", FIELDS)
  if (input.type !== "any") params.set("type", "parcel_locker")
  params.set("functions", "parcel_collect")
  if (input.cod) params.set("payment_available", "true")

  const lat = Number(input.lat)
  const lng = Number(input.lng)
  const hasPoint = input.lat !== null && input.lat !== undefined && input.lng !== null && input.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
  if (hasPoint) {
    if (lat < 48 || lat > 56 || lng < 13 || lng > 25) return { error: "query_invalid" }
    params.set("relative_point", `${lat.toFixed(5)},${lng.toFixed(5)}`)
    params.set("max_distance", "15000")
    return { params, mode: "near" }
  }

  const q = str(input.q, 80)
  if (!q) return { error: "query_missing" }
  const code = normalizeLockerCode(q)
  if (isLockerCode(code) && /\d/.test(code)) {
    params.set("name", code)
    params.delete("type")
    params.delete("functions")
    return { params, mode: "code" }
  }
  const digits = q.replace(/\D+/g, "")
  if (/^\d{2}-?\d{3}$/.test(q.replace(/\s+/g, "")) && digits.length === 5) {
    params.set("relative_post_code", `${digits.slice(0, 2)}-${digits.slice(2)}`)
    params.set("max_distance", "15000")
    return { params, mode: "postcode" }
  }
  if (!/^[\p{L}][\p{L}\s.'-]{1,59}$/u.test(q)) return { error: "query_invalid" }
  params.set("city", cityCase(q.replace(/\s+/g, " ")))
  return { params, mode: "city" }
}

export function normalizePoint(raw: unknown): PointDto | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  const code = normalizeLockerCode(p.name)
  if (!code) return null
  const addr = (p.address && typeof p.address === "object" ? p.address : {}) as Record<string, unknown>
  const det = (p.address_details && typeof p.address_details === "object" ? p.address_details : {}) as Record<string, unknown>
  const loc = (p.location && typeof p.location === "object" ? p.location : null) as Record<string, unknown> | null
  const lat = Number(loc?.latitude)
  const lng = Number(loc?.longitude)
  const distance = Number(p.distance)
  return {
    code,
    name: str(p.display_name) || `InPost ${code}`,
    type: Array.isArray(p.type) ? p.type.map((t) => str(t, 40)).filter(Boolean) : [],
    status: str(p.status, 40) || null,
    address: {
      line1: str(addr.line1),
      line2: str(addr.line2),
      street: str(det.street),
      building_number: str(det.building_number, 20),
      city: str(det.city, 80),
      post_code: str(det.post_code, 10),
      province: str(det.province, 60),
    },
    location: Number.isFinite(lat) && Number.isFinite(lng) && loc ? { lat, lng } : null,
    description: str(p.location_description, 300) || null,
    opening_hours: str(p.opening_hours, 120) || null,
    is_24_7: p.location_247 === true,
    payment_available: p.payment_available === true,
    distance: p.distance !== null && p.distance !== undefined && Number.isFinite(distance) ? Math.round(distance) : null,
  }
}

/** The locker in the shape the shipping method data keeps (machine_id, machine_name, machine_address). */
export function pointToMethodData(p: PointDto): { machine_id: string; machine_name: string; machine_address: { line1: string; line2: string; city: string; post_code: string } } {
  return {
    machine_id: p.code,
    machine_name: p.code,
    machine_address: { line1: p.address.line1, line2: p.address.line2, city: p.address.city, post_code: p.address.post_code },
  }
}

export function pointsHost(sandbox: boolean): string {
  return sandbox ? SHIPX_HOSTS.sandbox : SHIPX_HOSTS.production
}

/** One page of points. Throws on a network error or a non 2xx answer (callers decide what that means). */
export async function fetchPoints(params: URLSearchParams, opts: { sandbox: boolean; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<PointDto[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000)
  try {
    const doFetch = opts.fetchImpl ?? fetch
    const res = await doFetch(`${pointsHost(opts.sandbox)}/v1/points?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "KodaPlus-Medusa-InPost/0.1 (+https://koda.plus)" },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`InPost points answered ${res.status}`)
    const body = (await res.json()) as { items?: unknown[] }
    return (Array.isArray(body?.items) ? body.items : []).map(normalizePoint).filter((p): p is PointDto => p !== null)
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* A small TTL cache and a per key rate limiter, per process            */
/* ------------------------------------------------------------------ */

export class TtlCache<T> {
  private readonly map = new Map<string, { at: number; value: T }>()
  private readonly ttlMs: number
  private readonly max: number

  constructor(ttlMs: number, max = 500) {
    this.ttlMs = ttlMs
    this.max = max
  }

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (now - hit.at > this.ttlMs) {
      this.map.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { at: now, value })
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  get size(): number {
    return this.map.size
  }
}

/** A sliding window of one minute per key (an IP address). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly perMinute: number

  constructor(perMinute: number) {
    this.perMinute = perMinute
  }

  /** true when the request may go; false with the seconds to wait otherwise. */
  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
    const since = now - 60_000
    const list = (this.hits.get(key) ?? []).filter((t) => t > since)
    if (list.length >= this.perMinute) {
      this.hits.set(key, list)
      return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000)) }
    }
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((t) => t <= since)) this.hits.delete(k)
    }
    return { ok: true }
  }
}

/** The cache key of a search: the API query itself, which is already normalized. */
export function cacheKey(params: URLSearchParams, sandbox: boolean): string {
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `${sandbox ? "sbx" : "prd"}?${new URLSearchParams(sorted).toString()}`
}
