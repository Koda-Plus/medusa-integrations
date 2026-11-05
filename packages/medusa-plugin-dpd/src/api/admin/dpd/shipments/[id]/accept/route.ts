import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { acceptShipment } from "../../../../../../workflows/dpd/resolve"
import { actorOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/accept  {}  ->  ActionResponse
 *
 * Accepts the waybills DPD gave for a shipment that does not match what was
 * sent (ambiguous, with waybills): labeled when its label is stored, else
 * created. Nothing goes to DPD.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, () => acceptShipment(req.scope, shipmentIdOf(req), actorOf(req)))
}
