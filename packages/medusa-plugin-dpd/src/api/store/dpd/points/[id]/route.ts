import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientIp, pointsBudget, pointsLimiter, storePoint } from "../../../../../workflows/dpd/points"
import { ActionError, dpdService, refuse, sendError } from "../../../../admin/dpd/helpers"

/**
 * GET /store/dpd/points/:id  ->  PointResponse
 *
 * One DPD Pickup point by its id (for example the one the PudoFinder widget
 * gave), only when a parcel can go to it now: active, handing out parcels,
 * in Poland. Anything else is 404 point_not_found. Read `point.cod` to know
 * whether it takes cash on delivery. `public, max-age=300`, the 404 too. The
 * same limit per IP and the same budget as the search.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const gate = pointsLimiter(dpdService(req.scope).getOptions().pointsPerMinute).take(clientIp(req))
    if (!gate.ok) {
      res.setHeader("Retry-After", String(gate.retryAfter))
      refuse(res, 429, "rate_limited", "Too many point searches from this address. Try again in a moment.")
      return
    }
    const id = String((req.params as Record<string, unknown> | undefined)?.id ?? "")
    const body = await storePoint(req.scope, id, pointsBudget())
    res.setHeader("Cache-Control", "public, max-age=300")
    res.json(body)
  } catch (err) {
    if (err instanceof ActionError && err.code === "point_not_found") res.setHeader("Cache-Control", "public, max-age=300")
    sendError(req.scope, res, err)
  }
}
