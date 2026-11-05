import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { printProtocol } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, dispatchIdOf, respondDispatch } from "../../../helpers"

/**
 * POST /admin/dpd/dispatches/:id/print  {}  ->  DispatchResponse
 *
 * Prints the protocol of the dispatch: the first print (pending) hands the
 * shipments over, a reprint (printed, ordered) makes a new document. Needs
 * the armed shipment writer. A DPD refusal or an unclear answer is not an
 * HTTP error: 200 with the dispatch and its errorCode.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => printProtocol(req.scope, dispatchIdOf(req), { actor: actorOf(req) }))
}
