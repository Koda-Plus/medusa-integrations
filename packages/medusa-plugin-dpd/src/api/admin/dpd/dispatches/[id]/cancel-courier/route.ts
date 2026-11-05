import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelCourier } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, dispatchIdOf, respondDispatch } from "../../../helpers"

/**
 * POST /admin/dpd/dispatches/:id/cancel-courier  {}  ->  DispatchResponse
 *
 * Cancels the courier order of an ordered dispatch with its checkSum (409
 * no_check_sum without one: call the courier off at DPD and resolve the
 * order as not ordered). Needs the armed pickup writer.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => cancelCourier(req.scope, dispatchIdOf(req), { actor: actorOf(req) }))
}
