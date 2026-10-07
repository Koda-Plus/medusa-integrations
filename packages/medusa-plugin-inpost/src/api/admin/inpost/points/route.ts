import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { searchPoints } from "../../../../workflows/inpost/points"
import { intParam, sendError, strParam } from "../helpers"

/**
 * GET /admin/inpost/points?q=KRA01M | q=30-415 | q=Kraków | lat=&lng=  [&cod=true&type=any&limit=10]
 *
 * The locker search of the admin, for fixing the locker of a shipment before
 * it is sent. The public points API (no token), cached; the demo lockers in
 * demo mode.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const lat = strParam(req.query.lat)
    const lng = strParam(req.query.lng)
    res.json(
      await searchPoints(req.scope, {
        q: strParam(req.query.q) || null,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        limit: intParam(req.query.limit, 10, 1, 25),
        cod: strParam(req.query.cod) === "true",
        type: strParam(req.query.type) === "any" ? "any" : "locker",
      }),
    )
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
