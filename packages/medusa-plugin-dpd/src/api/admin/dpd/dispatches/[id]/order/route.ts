import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderCourier } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, bodyOf, courierWindowOf, dispatchIdOf, respondDispatch } from "../../../helpers"

/**
 * POST /admin/dpd/dispatches/:id/order  { pickupDate, pickupTimeFrom, pickupTimeTo }  ->  DispatchResponse
 *
 * Orders the courier for a printed dispatch, once: the window is checked
 * against the ranges read now, then one packagesPickupCall, never retried.
 * Needs the armed pickup writer. A second click gets 409 busy or
 * wrong_state, never a second order.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => {
    const id = dispatchIdOf(req)
    const window = courierWindowOf(bodyOf(req))
    return orderCourier(req.scope, id, window, { actor: actorOf(req) })
  })
}
