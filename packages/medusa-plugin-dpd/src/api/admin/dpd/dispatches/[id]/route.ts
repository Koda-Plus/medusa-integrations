import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { dispatchView } from "../../../../../workflows/dpd/dispatch"
import { dispatchIdOf, respondDispatch } from "../../helpers"

/**
 * GET /admin/dpd/dispatches/:id  ->  DispatchResponse
 *
 * One dispatch of the current mode with its current shipments, the problems
 * of their fulfillments read now, its history and the writers. 404 for an
 * unknown id and for a dispatch of another mode. No DPD call.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => dispatchView(req.scope, dispatchIdOf(req)))
}
