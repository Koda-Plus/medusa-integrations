import { PICKUP_COD_COUNTRY, POINTS_COORD_DECIMALS, POINTS_COUNTRY, POINTS_MAX_RESULTS, POINTS_RADIUS_M, SANDBOX_PUDO_ID } from "./constants"
import type { PointDto, PointsSourceKind, ProblemDto } from "./contract"
import { DEMO_POINT_CATALOG, DEMO_REFUSED_POINTS } from "./demo"
import type { LoggerLike } from "./dpdservices"
import { catalogPoint, createMyPudoClient, haversineM, weekdayHours, type MyPudoFailure } from "./mypudo"
import { normalizePudoId } from "./option-data"
import { pickupAuthOf, secretsOf, type ResolvedDpdOptions } from "./options"

/**
 * WHERE DPD PICKUP POINTS COME FROM, one source per mode on the same code
 * path:
 *
 *   live     MyPudoAPI (mypudo.ts); without its credentials not_configured
 *   sandbox  SANDBOX_POINTS: PL14509 (the one point the DPD demo host takes)
 *            and two points the plugin refuses
 *   demo     DEMO_POINT_CATALOG and DEMO_REFUSED_POINTS (demo.ts)
 *
 * Sandbox and demo never call fetch. `search` answers only points a parcel
 * can go to; `details` answers any point as it is now, and pointProblems
 * says what is wrong with it. The cache and the limiter are the ones of the
 * InPost plugin, copied (zero runtime dependencies).
 */

export type PointsFailure = MyPudoFailure

/** What a fresh read of a point gave. */
export type PointCheck =
  | { status: "ok"; pudoId: string; point: PointDto }
  | { status: "not_found"; pudoId: string }
  | { status: "unchecked"; pudoId: string; reason: PointsFailure }

/**
 * What is asked of a source; also the cache key (DS8). No cod and no limit: the
 * source answers up to POINTS_MAX_RESULTS points, the route filters cod and cuts
 * to limit after the cache (E20). lat and lng already rounded to
 * POINTS_COORD_DECIMALS; city and address lower case, single spaces.
 */
export type PointsQuery =
  | { by: "address"; country: string; zip: string; city: string | null; address: string | null }
  | { by: "coords"; lat: number; lng: number }

/** What a route asked: the source query plus the filter and the cut done after the cache. */
export type PointsRequest = { query: PointsQuery; cod: boolean; limit: number }

export type PointsResult = { ok: true; points: PointDto[] } | { ok: false; reason: PointsFailure }

/** One source per mode; sandbox and demo never call fetch. */
export type PointsSource = {
  readonly kind: PointsSourceKind
  /** Only points a parcel can go to: active, service 100, country PL (E21); up to POINTS_MAX_RESULTS, by distance or by zip. */
  search(q: PointsQuery): Promise<PointsResult>
  /** Any point by id, as it is now (inactive and non-delivering ones too): the checks are pointProblems. */
  details(pudoId: string): Promise<PointCheck>
}

export type PointsSourceDeps = {
  fetchImpl?: typeof fetch
  logger?: LoggerLike
  requestId?: () => string
}

/** demo: DEMO_POINT_CATALOG and DEMO_REFUSED_POINTS; sandbox: SANDBOX_POINTS; live: createMyPudoClient. */
export function createPointsSource(options: ResolvedDpdOptions, deps: PointsSourceDeps = {}): PointsSource {
  if (options.demo || options.mode === "demo") return catalogSource("demo", [...DEMO_POINT_CATALOG, ...DEMO_REFUSED_POINTS])
  /* MyPudo has no test host, and the DPD demo host takes PL14509 only: the sandbox never calls MyPudo. */
  if (options.mode === "sandbox") return catalogSource("sandbox", SANDBOX_POINTS)
  const client = createMyPudoClient({
    auth: pickupAuthOf(options),
    timeoutMs: options.pointsTimeoutMs,
    fetchImpl: deps.fetchImpl,
    secrets: secretsOf(options),
    logger: deps.logger,
    requestId: deps.requestId,
  })
  return {
    kind: "live",
    async search(q) {
      const res =
        q.by === "address"
          ? await client.search({ by: "address", country: q.country, zip: q.zip, city: q.city ?? undefined, address: q.address ?? undefined, limit: POINTS_MAX_RESULTS })
          : await client.search({ by: "coords", lat: q.lat, lng: q.lng, radiusM: POINTS_RADIUS_M, limit: POINTS_MAX_RESULTS })
      if (!res.ok) return { ok: false, reason: res.reason }
      /* E21: a coordinate search near a border can find points abroad; stage 3 ships to Poland only. */
      return { ok: true, points: res.points.filter((p) => isDeliverable(p, false) && p.address.country === POINTS_COUNTRY) }
    },
    async details(pudoId) {
      const id = normalizePudoId(pudoId)
      const res = await client.details(id)
      if (res.ok) return { status: "ok", pudoId: id, point: res.point }
      if (res.reason === "not_found") return { status: "not_found", pudoId: id }
      return { status: "unchecked", pudoId: id, reason: res.reason }
    },
  }
}

const copyOf = (p: PointDto, distance: number | null): PointDto => ({
  ...p,
  address: { ...p.address },
  services: [...p.services],
  hours: p.hours.map((h) => ({ ...h })),
  limits: { ...p.limits, box: { ...p.limits.box } },
  distance,
})

const digits = (v: string) => v.replace(/\D/g, "")
const words = (v: string | null) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase()

/** A source over a fixed list (demo, sandbox, tests): search filters and sorts like live. */
export function catalogSource(kind: PointsSourceKind, points: readonly PointDto[]): PointsSource {
  const list = points.map((p) => copyOf(p, null))
  return {
    kind,
    async search(q) {
      const open = list.filter((p) => isDeliverable(p, false) && p.address.country === POINTS_COUNTRY)
      if (q.by === "coords") {
        const measured = open.map((p) => copyOf(p, p.lat !== null && p.lng !== null ? distanceM(q, { lat: p.lat, lng: p.lng }) : null))
        measured.sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY))
        return { ok: true, points: measured.slice(0, POINTS_MAX_RESULTS) }
      }
      if (q.country.toUpperCase() !== POINTS_COUNTRY) return { ok: true, points: [] }
      /* The same postal code first, then the same city, then the rest, each in catalog order. */
      const rank = (p: PointDto) => (digits(p.address.zip) === digits(q.zip) ? 0 : q.city && words(p.address.city) === words(q.city) ? 1 : 2)
      const ranked = open.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i)
      return { ok: true, points: ranked.slice(0, POINTS_MAX_RESULTS).map((x) => copyOf(x.p, null)) }
    },
    async details(pudoId) {
      const id = normalizePudoId(pudoId)
      const hit = list.find((p) => p.id === id)
      return hit ? { status: "ok", pudoId: id, point: copyOf(hit, null) } : { status: "not_found", pudoId: id }
    },
  }
}

/** The test catalog of the sandbox (spec 12.2): PL14509, the one point the DPD demo host takes, and two points the plugin refuses. */
export const SANDBOX_POINTS: readonly PointDto[] = [
  /* The name and address as the label of fixture 10j prints them (E16); the coordinates are approximate, for sorting. */
  catalogPoint({ id: SANDBOX_PUDO_ID, name: "DPD Pickup, Oddział Miejski", type: "300", line1: "Skoroszewska 11", zip: "02-495", city: "Warszawa", lat: 52.1937, lng: 20.9278, active: true, services: ["100", "101", "200"], hours: weekdayHours("08:00", "18:00") }),
  catalogPoint({ id: "PL0SBX01", name: "Punkt testowy nieczynny", type: "100", line1: "Testowa 1", zip: "02-495", city: "Warszawa", active: false, services: ["100", "101"], hours: weekdayHours("08:00", "18:00") }),
  catalogPoint({ id: "PL0SBX02", name: "Punkt testowy tylko nadania", type: "200", line1: "Testowa 2", zip: "02-495", city: "Warszawa", active: true, services: ["200"], hours: weekdayHours("08:00", "18:00") }),
]

/** The point problems of a check, for the plan, the provider and the point change (spec 7.2, step 4). */
export function pointProblems(check: PointCheck, need: { cod: boolean }): ProblemDto[] {
  const at = (code: string): ProblemDto => ({ code, field: "pudoId", detail: check.pudoId })
  if (check.status === "not_found") return [at("pudo_not_found")]
  /* Unchecked is a warning of the plan (pudo_unchecked), never a problem: DPD checks the point when the shipment is created. */
  if (check.status === "unchecked") return []
  const out: ProblemDto[] = []
  if (!check.point.active) out.push(at("pudo_inactive"))
  if (!check.point.delivery) out.push(at("pudo_no_delivery"))
  if (need.cod && !check.point.cod) out.push(at("pudo_no_cod"))
  return out
}

/** active && delivery && (!cod || (point.cod && country PL)). */
export function isDeliverable(p: PointDto, cod: boolean): boolean {
  return p.active && p.delivery && (!cod || (p.cod && p.address.country === PICKUP_COD_COUNTRY))
}

/** Haversine, metres, rounded. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineM(a, b)
}

/** Port of the InPost TtlCache (same API): entries live ttlMs, the oldest go past max. */
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

/**
 * Port of the InPost RateLimiter (same API): a sliding window of one minute
 * per key (an IP address). The keys are kept in the order of their last
 * call, so the ones idle for a minute are at the front and pruning stops at
 * the first live one; past `maxKeys` the least recently used go. A public
 * route then costs the same per call however many addresses call it.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly perMinute: number
  private readonly maxKeys: number

  constructor(perMinute: number, maxKeys = 10_000) {
    this.perMinute = perMinute
    this.maxKeys = maxKeys
  }

  /** ok when the request may go; otherwise the seconds to wait. */
  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
    const since = now - 60_000
    const list = (this.hits.get(key) ?? []).filter((t) => t > since)
    /* Deleted and set again: the key moves to the end, the order of last use. */
    this.hits.delete(key)
    this.hits.set(key, list)
    for (const [k, v] of this.hits) {
      if (k === key || (v.length > 0 && v[v.length - 1] > since)) break
      this.hits.delete(k)
    }
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value
      if (oldest === undefined || oldest === key) break
      this.hits.delete(oldest)
    }
    if (list.length >= this.perMinute) return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000)) }
    list.push(now)
    return { ok: true }
  }

  /** The keys held now (at most maxKeys). */
  get size(): number {
    return this.hits.size
  }
}

const roundCoord = (n: number) => Number(n.toFixed(POINTS_COORD_DECIMALS))

/** Mode plus the normalized query, keys sorted; never cod or limit (DS8). */
export function pointsCacheKey(kind: PointsSourceKind, q: PointsQuery | { by: "id"; id: string }): string {
  /* Normalized again here, so a key never depends on who built the query. */
  const fields: Record<string, string> =
    q.by === "id"
      ? { by: "id", id: normalizePudoId(q.id) }
      : q.by === "coords"
        ? { by: "coords", lat: String(roundCoord(q.lat)), lng: String(roundCoord(q.lng)) }
        : { by: "address", country: q.country.trim().toUpperCase(), zip: digits(q.zip), city: words(q.city), address: words(q.address) }
  const sorted = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(fields[k])}`)
  return `${kind}?${sorted.join("&")}`
}

/** The route's own filter after the cache: isDeliverable(p, cod), then the first `limit`. */
export function pointsForRequest(points: readonly PointDto[], r: PointsRequest): PointDto[] {
  const limit = Math.max(1, Math.min(POINTS_MAX_RESULTS, Math.floor(r.limit)))
  return points.filter((p) => isDeliverable(p, r.cod)).slice(0, limit)
}
