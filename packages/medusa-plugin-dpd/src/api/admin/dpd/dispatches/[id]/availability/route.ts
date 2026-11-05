import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { courierAvailability } from "../../../../../../workflows/dpd/dispatch"
import { dispatchIdOf, noStore, sendError } from "../../../helpers"

/**
 * GET /admin/dpd/dispatches/:id/availability  ->  AvailabilityResponse
 *
 * The courier windows for the sender postal code of a printed or ordered
 * dispatch, read now (one DPD call; in demo the sample ranges). No writer,
 * nothing stored, no history.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    res.json(await courierAvailability(req.scope, dispatchIdOf(req)))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
