/**
 * LOCKER SEARCH for the admin (fixing a locker before shipping) and the
 * storefront (GET /store/inpost/points, for stores without the Geowidget).
 * The public points API needs no token; answers are cached ten minutes per
 * process. Demo mode searches the demo lockers and sends nothing to InPost.
 */

import type { PointsResponse } from "../../modules/inpost/lib/contract"
import { searchDemoPoints, demoPoints } from "../../modules/inpost/lib/demo"
import { cacheKey, fetchPoints, pointsParams, TtlCache, type PointDto, type PointsQuery } from "../../modules/inpost/lib/points"
import { ActionError, inpostService, type Scope } from "./runtime"

const CACHE = new TtlCache<PointDto[]>(10 * 60 * 1000, 500)

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)))
}

export async function searchPoints(scope: Scope, input: PointsQuery): Promise<PointsResponse> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  const q = pointsParams(input)
  if ("error" in q) {
    throw new ActionError(400, q.error, q.error === "query_missing" ? "Send q (a locker code, a post code or a city) or lat and lng." : "The search is not a locker code, a post code, a city or a place in Poland.")
  }
  const limit = Math.min(25, Math.max(1, Math.floor(Number(input.limit ?? 10) || 10)))
  if (o.demo) {
    if (q.mode === "near" && input.lat !== null && input.lat !== undefined && input.lng !== null && input.lng !== undefined) {
      const here = { lat: Number(input.lat), lng: Number(input.lng) }
      const points = demoPoints()
        .map((p) => ({ ...p, distance: p.location ? distanceM(here, p.location) : null }))
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
        .slice(0, limit)
      return { points, mode: q.mode, demo: true }
    }
    return { points: searchDemoPoints(input.q, limit), mode: q.mode, demo: true }
  }
  const key = cacheKey(q.params, o.sandbox)
  const cached = CACHE.get(key)
  if (cached) return { points: cached, mode: q.mode, demo: false }
  try {
    const points = await fetchPoints(q.params, { sandbox: o.sandbox, timeoutMs: 8000 })
    CACHE.set(key, points)
    return { points, mode: q.mode, demo: false }
  } catch (err) {
    throw new ActionError(502, "points_unavailable", `The InPost points API did not answer: ${(err as Error)?.message ?? String(err)}`)
  }
}
