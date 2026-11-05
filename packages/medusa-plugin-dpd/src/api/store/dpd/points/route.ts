import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientIp, pointsBudget, pointsLimiter, pointsQueryOf, searchPoints } from "../../../../workflows/dpd/points"
import { dpdService, refuse, sendError } from "../../../admin/dpd/helpers"

/**
 * GET /store/dpd/points?zip=02-495[&city=Warszawa&address=Skoroszewska 11] | lat=52.19&lng=20.93  [&cod=true&limit=10]  ->  PointsResponse
 *
 * DPD Pickup points for a storefront without the PudoFinder widget: by a
 * Polish postal code (with the city and the street if you like) or by a
 * place (nearest first, within 5 km). Only points a parcel can go to now:
 * active, handing out parcels, in Poland; with cod=true also taking cash on
 * delivery. Public point data only, `public, max-age=300`. Medusa asks for
 * the publishable API key, as on every /store route. Limited per IP
 * (`pointsPerMinute`, 429 rate_limited with Retry-After); searches are
 * cached ten minutes, and the calls of the store routes to the point source
 * have a budget per process (503 points_unavailable with Retry-After). The
 * source of the mode answers: MyPudo live, the test catalog in the sandbox,
 * the sample catalog in demo mode. Store the chosen id as `pudo_id` in the
 * shipping method data.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const gate = pointsLimiter(dpdService(req.scope).getOptions().pointsPerMinute).take(clientIp(req))
    if (!gate.ok) {
      res.setHeader("Retry-After", String(gate.retryAfter))
      refuse(res, 429, "rate_limited", "Too many point searches from this address. Try again in a moment.")
      return
    }
    const body = await searchPoints(req.scope, pointsQueryOf(req.query as Record<string, unknown>), pointsBudget())
    res.setHeader("Cache-Control", "public, max-age=300")
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
