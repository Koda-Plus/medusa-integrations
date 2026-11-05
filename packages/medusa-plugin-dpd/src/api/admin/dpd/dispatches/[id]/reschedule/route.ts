import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { rescheduleCourier } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, bodyOf, courierWindowOf, dispatchIdOf, respondDispatch } from "../../../helpers"

/**
 * POST /admin/dpd/dispatches/:id/reschedule  { pickupDate, pickupTimeFrom, pickupTimeTo }  ->  DispatchResponse
 *
 * Changes the pickup of an ordered dispatch with its checkSum. The same
 * window as stored answers 200 without a DPD call. Needs the armed pickup
 * writer.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => {
    const id = dispatchIdOf(req)
    const window = courierWindowOf(bodyOf(req))
    return rescheduleCourier(req.scope, id, window, { actor: actorOf(req) })
  })
}
