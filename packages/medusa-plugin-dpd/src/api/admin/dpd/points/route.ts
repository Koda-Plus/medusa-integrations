import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pointsQueryOf, searchPoints } from "../../../../workflows/dpd/points"
import { noStore, sendError } from "../helpers"

/**
 * GET /admin/dpd/points?zip=02-495[&city=Warszawa] | lat=52.19&lng=20.93  [&cod=true&limit=10]  ->  PointsResponse
 *
 * The point search of the admin (changing the point of a shipment): the same
 * query, source and cache as GET /store/dpd/points, without the limit per IP
 * and the budget of the store routes. Private, no-store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    res.json(await searchPoints(req.scope, pointsQueryOf(req.query as Record<string, unknown>)))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
