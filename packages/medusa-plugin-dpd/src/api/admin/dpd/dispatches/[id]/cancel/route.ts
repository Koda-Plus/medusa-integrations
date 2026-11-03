import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelDispatch } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, dispatchIdOf, respondDispatch } from "../../../helpers"

/**
 * POST /admin/dpd/dispatches/:id/cancel  {}  ->  DispatchResponse
 *
 * Cancels a pending or printed dispatch: its shipments are released and
 * their handover markers cleared. Local, nothing goes to DPD; writer
 * shipment.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => cancelDispatch(req.scope, dispatchIdOf(req), { actor: actorOf(req) }))
}
