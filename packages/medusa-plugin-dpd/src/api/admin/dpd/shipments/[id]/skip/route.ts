import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { skipShipment } from "../../../../../../workflows/dpd/resolve"
import { actorOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/skip  {}  ->  ActionResponse
 *
 * Marks a shipment as shipped outside Medusa: one not created yet (pending),
 * refused (failed) or not matching DPD (ambiguous). Nothing goes to DPD.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, () => skipShipment(req.scope, shipmentIdOf(req), actorOf(req)))
}
