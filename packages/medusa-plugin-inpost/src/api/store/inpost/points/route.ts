import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RateLimiter } from "../../../../modules/inpost/lib/points"
import { searchPoints } from "../../../../workflows/inpost/points"
import { ActionError, inpostService } from "../../../../workflows/inpost/runtime"

/**
 * GET /store/inpost/points?q=KRA01M | q=30-415 | q=Kraków | lat=52.23&lng=21.01  [&cod=true&type=any&limit=10]
 *
 * Parcel lockers for a storefront that does not use the Geowidget: a locker
 * code, a post code (nearest first), a city, or a place (nearest first, within
 * 15 km). Public points data only (code, name, address, location, opening
 * hours, whether the point takes card payments), cached for ten minutes,
 * limited per IP (`pointsPerMinute`, 60 by default). Medusa asks for the
 * publishable API key, as on every /store route. Demo mode answers with the
 * demo lockers. Store the chosen point in the shipping method data as
 * `machine_id`, `machine_name` and `machine_address` (the README shows how).
 */

const LIMITER_KEY = Symbol.for("koda.inpost.pointsLimiter")
type Holder = typeof globalThis & { [LIMITER_KEY]?: { perMinute: number; limiter: RateLimiter } }

function limiter(perMinute: number): RateLimiter {
  const holder = globalThis as Holder
  if (!holder[LIMITER_KEY] || holder[LIMITER_KEY]?.perMinute !== perMinute) holder[LIMITER_KEY] = { perMinute, limiter: new RateLimiter(perMinute) }
  return (holder[LIMITER_KEY] as { limiter: RateLimiter }).limiter
}

function clientIp(req: MedusaRequest): string {
  const forwarded = req.headers["x-forwarded-for"]
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? "").split(",")[0].trim()
  return first || req.ip || req.socket?.remoteAddress || "unknown"
}

const one = (v: unknown): string => {
  const x = Array.isArray(v) ? v[0] : v
  return typeof x === "string" ? x.trim() : ""
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = inpostService(req.scope)
  const gate = limiter(svc.getOptions().pointsPerMinute).take(clientIp(req))
  if (!gate.ok) {
    res.setHeader("Retry-After", String(gate.retryAfter))
    res.status(429).json({ code: "rate_limited", message: "Too many locker searches. Try again in a moment." })
    return
  }
  try {
    const lat = one(req.query.lat)
    const lng = one(req.query.lng)
    const result = await searchPoints(req.scope, {
      q: one(req.query.q) || null,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      limit: Number(one(req.query.limit)) || 10,
      cod: one(req.query.cod) === "true",
      type: one(req.query.type) === "any" ? "any" : "locker",
    })
    res.setHeader("Cache-Control", "public, max-age=300")
    res.json(result)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ code: err.code, message: err.message })
      return
    }
    res.status(502).json({ code: "points_unavailable", message: "Parcel lockers are unavailable right now." })
  }
}
