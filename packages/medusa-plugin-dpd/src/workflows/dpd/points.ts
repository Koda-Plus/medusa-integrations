/**
 * DPD PICKUP POINTS for the storefront (GET /store/dpd/points and
 * /store/dpd/points/:id) and the admin (GET /admin/dpd/points, and the point
 * change of a shipment).
 *
 * The searches go through a TTL cache per points source (there is one source
 * per service instance, so one cache per process): searches 10 minutes,
 * point details 60 minutes, a point that is not there 10 minutes. The key is
 * the normalized query only (pointsCacheKey), never cod or limit: the cache
 * keeps the list of the source and the filter and the cut run after it.
 * Failures are never cached. The store routes have a limit per IP and a
 * budget of source calls per process (cache misses only), so an anonymous
 * client cannot spend the MyPudo calls of the store.
 *
 * The point change is not a write to DPD: it changes the plugin's own row
 * (the point and the problems) and the history, and needs no armed writer.
 * It never fails open: a point that cannot be checked is not set.
 */

import {
  OPTION_SPECS,
  POINTS_COORD_DECIMALS,
  POINTS_COUNTRY,
  POINTS_DEFAULT_RESULTS,
  POINTS_DETAILS_TTL_MS,
  POINTS_MAX_RESULTS,
  POINTS_MISSING_TTL_MS,
  POINTS_SEARCH_TTL_MS,
  POINTS_STORE_CALLS_PER_MINUTE,
} from "../../modules/dpd/lib/constants"
import type { PointDto, PointResponse, PointsResponse, ProblemDto } from "../../modules/dpd/lib/contract"
import type { ShipmentRow } from "../../modules/dpd/lib/dto"
import { isPudoId, normalizePudoId } from "../../modules/dpd/lib/option-data"
import type { Plan } from "../../modules/dpd/lib/plan"
import { isDeliverable, pointProblems, pointsCacheKey, pointsForRequest, RateLimiter, TtlCache, type PointCheck, type PointsFailure, type PointsQuery, type PointsRequest, type PointsSource } from "../../modules/dpd/lib/points"
import { mergeProblems, planInputsOf, planOf } from "./plan"
import { ActionError, dpdService, errorText, getShipmentOfMode, pointsFor, recordEvent, storeFor, type Scope } from "./runtime"

/* ------------------------------------------------------------------ */
/* The query of the search routes                                      */
/* ------------------------------------------------------------------ */

const CITY_MAX = 50
const ADDRESS_MAX = 60

const one = (v: unknown): string => {
  const x = Array.isArray(v) ? v[0] : v
  return typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : ""
}

const words = (v: string): string => v.replace(/\s+/g, " ").trim().toLowerCase()

const invalid = (message: string) => new ActionError(400, "invalid", message)

function coordinate(raw: string, name: "lat" | "lng", max: number): number {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n) || Math.abs(n) > max) throw invalid(`${name} is a number from -${max} to ${max}.`)
  return n
}

/**
 * The query of both search routes: zip (5 digits, a dash allowed) with
 * optional city and address and country (PL only in this version), or lat
 * and lng; cod true or false; limit 1 to 25 (10 by default). 400 invalid
 * names the parameter (no `fields`: those are box indexes).
 */
export function pointsQueryOf(query: Record<string, unknown>): PointsRequest {
  const zipRaw = one(query.zip)
  const cityRaw = one(query.city)
  const addressRaw = one(query.address)
  const countryRaw = one(query.country)
  const latRaw = one(query.lat)
  const lngRaw = one(query.lng)
  const byZip = zipRaw !== ""
  const byCoords = latRaw !== "" || lngRaw !== ""
  if (byZip && byCoords) throw invalid("Search by zip or by lat and lng, not both.")
  if (!byZip && !byCoords) throw invalid("Send zip (with city and address if you like) or lat and lng.")
  if (!byZip && (cityRaw || addressRaw || countryRaw)) throw invalid("city, address and country go with zip.")

  const codRaw = one(query.cod)
  if (codRaw !== "" && codRaw !== "true" && codRaw !== "false") throw invalid("cod is true or false.")
  const limitRaw = one(query.limit)
  const limit = limitRaw === "" ? POINTS_DEFAULT_RESULTS : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > POINTS_MAX_RESULTS) throw invalid(`limit is a whole number from 1 to ${POINTS_MAX_RESULTS}.`)
  const cod = codRaw === "true"

  let q: PointsQuery
  if (byZip) {
    const zip = zipRaw.replace("-", "")
    if (!/^\d{5}$/.test(zip)) throw invalid("zip is a Polish postal code: five digits, like 02-495.")
    if (cityRaw.length > CITY_MAX) throw invalid(`city is at most ${CITY_MAX} characters.`)
    if (addressRaw.length > ADDRESS_MAX) throw invalid(`address is at most ${ADDRESS_MAX} characters.`)
    const country = (countryRaw || POINTS_COUNTRY).toUpperCase()
    if (country !== POINTS_COUNTRY) throw invalid("country is PL: DPD Pickup points outside Poland come in a later version.")
    q = { by: "address", country, zip, city: cityRaw ? words(cityRaw) : null, address: addressRaw ? words(addressRaw) : null }
  } else {
    if (latRaw === "" || lngRaw === "") throw invalid("Send both lat and lng.")
    const lat = coordinate(latRaw, "lat", 90)
    const lng = coordinate(lngRaw, "lng", 180)
    q = { by: "coords", lat: Number(lat.toFixed(POINTS_COORD_DECIMALS)), lng: Number(lng.toFixed(POINTS_COORD_DECIMALS)) }
  }
  return { query: q, cod, limit }
}

/* ------------------------------------------------------------------ */
/* Caches, the limit per IP and the budget of the store routes         */
/* ------------------------------------------------------------------ */

type Caches = { search: TtlCache<PointDto[]>; details: TtlCache<PointDto>; missing: TtlCache<true> }

/* One set per source: one source per service instance, so one per process in Medusa (and none shared between tests). */
const caches = new WeakMap<PointsSource, Caches>()

function cachesOf(source: PointsSource): Caches {
  const known = caches.get(source)
  if (known) return known
  const made: Caches = { search: new TtlCache<PointDto[]>(POINTS_SEARCH_TTL_MS, 500), details: new TtlCache<PointDto>(POINTS_DETAILS_TTL_MS, 1000), missing: new TtlCache<true>(POINTS_MISSING_TTL_MS, 1000) }
  caches.set(source, made)
  return made
}

const LIMITER_KEY = Symbol.for("koda.dpd.pointsLimiter")
const BUDGET_KEY = Symbol.for("koda.dpd.pointsBudget")
type Holder = typeof globalThis & { [LIMITER_KEY]?: { perMinute: number; limiter: RateLimiter }; [BUDGET_KEY]?: RateLimiter }

/** The limiter of both store routes, one per process, in a globalThis Symbol (InPost pattern); a new one when pointsPerMinute changes. */
export function pointsLimiter(perMinute: number): RateLimiter {
  const holder = globalThis as Holder
  const known = holder[LIMITER_KEY]
  if (known && known.perMinute === perMinute) return known.limiter
  const limiter = new RateLimiter(perMinute)
  holder[LIMITER_KEY] = { perMinute, limiter }
  return limiter
}

/** The global budget of source calls of the store routes (key "store"), one per process, in a globalThis Symbol. */
export function pointsBudget(): RateLimiter {
  const holder = globalThis as Holder
  const known = holder[BUDGET_KEY]
  if (known) return known
  const budget = new RateLimiter(POINTS_STORE_CALLS_PER_MINUTE)
  holder[BUDGET_KEY] = budget
  return budget
}

/**
 * The client address as Medusa resolved it (Express `trust proxy`), never
 * the first X-Forwarded-For value, which the client writes itself: a new
 * value per request would make the limit endless.
 */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || "unknown"
}

/* ------------------------------------------------------------------ */
/* Search and details                                                  */
/* ------------------------------------------------------------------ */

/** 503 when the source is not configured, 502 for any other failure; the reason only, never a URL or what MyPudo answered. */
function unavailable(reason: PointsFailure): ActionError {
  return reason === "not_configured"
    ? new ActionError(503, "points_unavailable", "The DPD point search is not configured (MyPudo credentials are missing).")
    : new ActionError(502, "points_unavailable", `The DPD point search did not answer (${reason}). Try again in a moment.`)
}

/** One source call of a store route, from the budget; refused: 503 with Retry-After. */
function spend(budget: RateLimiter | undefined): void {
  if (!budget) return
  const gate = budget.take("store")
  if (!gate.ok) throw new ActionError(503, "points_unavailable", "The DPD point search is busy. Try again in a moment.", undefined, undefined, gate.retryAfter)
}

/** A point a parcel can go to in this version: active, handing out parcels, in Poland. */
const isStorePoint = (p: PointDto) => isDeliverable(p, false) && p.address.country === POINTS_COUNTRY

/**
 * Search with the TTL cache keyed by r.query only, then pointsForRequest
 * (cod, limit). Failures are not cached. `budget`: the store routes pass the
 * per process limiter of POINTS_STORE_CALLS_PER_MINUTE, taken on a cache miss
 * only; refused: 503 points_unavailable with retryAfter.
 */
export async function searchPoints(scope: Scope, r: PointsRequest, budget?: RateLimiter): Promise<PointsResponse> {
  const source = pointsFor(scope)
  const cache = cachesOf(source).search
  const key = pointsCacheKey(source.kind, r.query)
  let points = cache.get(key)
  if (!points) {
    spend(budget)
    let result: Awaited<ReturnType<PointsSource["search"]>>
    try {
      result = await source.search(r.query)
    } catch (err) {
      const svc = dpdService(scope)
      svc.getLogger().warn(`[dpd] The point search failed: ${errorText(svc, err)}`)
      result = { ok: false, reason: "network" }
    }
    if (!result.ok) throw unavailable(result.reason)
    points = result.points
    cache.set(key, points)
  }
  return { points: pointsForRequest(points, r), source: source.kind }
}

/** A fresh details read; a source that throws is an unchecked point (network), logged masked. */
async function readPoint(scope: Scope, source: PointsSource, pudoId: string): Promise<PointCheck> {
  try {
    return await source.details(pudoId)
  } catch (err) {
    const svc = dpdService(scope)
    svc.getLogger().warn(`[dpd] Could not read Pickup point ${pudoId}: ${errorText(svc, err)}`)
    return { status: "unchecked", pudoId, reason: "network" }
  }
}

/**
 * One point a parcel can go to (active, service 100, in Poland), with the
 * cache (details 60 minutes; not there, inactive or not handing out parcels
 * 10 minutes); 404 point_not_found otherwise, 400 invalid for an id that is
 * not a DPD Pickup id.
 */
export async function storePoint(scope: Scope, id: string, budget?: RateLimiter): Promise<PointResponse> {
  const pudoId = normalizePudoId(id)
  if (!isPudoId(pudoId)) throw invalid("The point id is not a DPD Pickup point id.")
  const source = pointsFor(scope)
  const c = cachesOf(source)
  const key = pointsCacheKey(source.kind, { by: "id", id: pudoId })
  const notFound = () => new ActionError(404, "point_not_found", `No DPD Pickup point a parcel can go to has the id ${pudoId}.`)
  if (c.missing.get(key)) throw notFound()
  const cached = c.details.get(key)
  if (cached) return { point: cached, source: source.kind }
  spend(budget)
  const check = await readPoint(scope, source, pudoId)
  if (check.status === "unchecked") throw unavailable(check.reason)
  if (check.status === "not_found" || !isStorePoint(check.point)) {
    c.missing.set(key, true)
    throw notFound()
  }
  c.details.set(key, check.point)
  return { point: check.point, source: source.kind }
}

/* ------------------------------------------------------------------ */
/* The point change of a shipment                                      */
/* ------------------------------------------------------------------ */

/**
 * POST /admin/dpd/shipments/:id/point: a pending or failed Pickup row gets
 * another point, checked fresh (never failing open). The problems of the
 * point itself refuse it (422 point_refused); the box problems do not (a
 * person changes the boxes in the same plan). Writes the point and the new
 * problems in one transition and a history line; never the order, the
 * fulfillment or a message to the customer.
 */
export async function changePoint(scope: Scope, id: string, pudoId: string, actor: string | null): Promise<{ row: ShipmentRow; plan: Plan }> {
  const svc = dpdService(scope)
  const next = normalizePudoId(pudoId)
  if (!next || !isPudoId(next)) throw invalid("The point id is not a DPD Pickup point id.")
  const row = await getShipmentOfMode(svc, id)
  if (!row) throw new ActionError(404, "not_found", "No DPD shipment with this id in the current mode.")
  const spec = OPTION_SPECS.find((s) => s.id === row.option_id)
  if (!spec || spec.kind !== "pickup" || row.kind === "return") throw new ActionError(409, "not_pickup", "This shipment does not go to a DPD Pickup point.")
  if (row.state !== "pending" && row.state !== "failed") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: the point changes only before the shipment is created.`)
  if (next === row.pudo_id) return { row, plan: (await planOf(scope, row)).plan }

  const check = await readPoint(scope, pointsFor(scope), next)
  if (check.status === "unchecked") {
    throw check.reason === "not_configured"
      ? new ActionError(503, "points_unavailable", "The point cannot be checked: MyPudo is not configured. Nothing was changed.")
      : new ActionError(502, "points_unavailable", `The point could not be checked now (${check.reason}). Nothing was changed; try again in a moment.`)
  }
  const refused: ProblemDto[] = pointProblems(check, { cod: spec.cod })
  if (check.status === "ok") {
    const country = check.point.address.country
    if (country !== POINTS_COUNTRY) {
      refused.push({ code: "abroad_later", field: "pudoId", detail: country })
      if (spec.cod) refused.push({ code: "cod_pickup_abroad", field: "pudoId", detail: country })
    }
  }
  if (refused.length > 0) throw new ActionError(422, "point_refused", `The point ${next} cannot take this shipment: ${refused.map((p) => p.code).join(", ")}.`, undefined, refused)
  const country = check.status === "ok" ? check.point.address.country : POINTS_COUNTRY

  const draft: ShipmentRow = { ...row, pudo_id: next, country_code: country }
  const { plan } = await planOf(scope, draft, check)
  const problems = mergeProblems(plan.problems, row.problems, row.state, { dropPointAnswers: true })
  /* Only over the point and boxes this change read: of two changes at once, the second finds the point moved and writes nothing. */
  const moved = await storeFor(scope).transition(row.id, [row.state], { pudo_id: next, country_code: country, problems }, planInputsOf(row))
  if (!moved) throw new ActionError(409, "wrong_state", "The shipment changed a moment ago (its state, point or boxes); read it again.")
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: actor ? "admin" : "system",
    actor,
    message: `Pickup point changed from ${row.pudo_id ?? "none"} to ${next}.`,
    data: { action: "point_changed", from: row.pudo_id ?? null, to: next },
    mode: svc.mode(),
  })
  return { row: moved, plan }
}
