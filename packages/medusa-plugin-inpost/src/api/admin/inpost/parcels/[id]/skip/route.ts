import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { skipParcel } from "../../../../../../workflows/inpost/parcels"
import { actorOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/skip
 *
 * The shipment is handled outside the plugin (sent from InPost Manager, by
 * another carrier): the row leaves the shipments to create and nothing will
 * ever be sent for it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondParcel(req, res, () => skipParcel(req.scope, req.params.id, actorOf(req)))
}
