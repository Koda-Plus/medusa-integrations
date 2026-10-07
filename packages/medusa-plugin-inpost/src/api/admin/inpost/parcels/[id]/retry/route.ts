import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryParcel } from "../../../../../../workflows/inpost/parcels"
import { actorOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/retry
 *
 * A failed shipment goes back to the ones to create: after the cause is fixed
 * (an address in Medusa, a locker, the account in InPost Manager), a person
 * reads the new plan and creates it. A row in `unknown` must be looked up
 * first: the shipment may exist.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondParcel(req, res, () => retryParcel(req.scope, req.params.id, actorOf(req)))
}
