import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { linkShipment } from "../../../../../../workflows/inpost/parcels"
import { actorOf, bodyOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/link  { "shipmentId": "1234567890" }
 *
 * Links an existing ShipX shipment of the organization (found in InPost
 * Manager) to the row: the shipment is read first. A row in `unknown` adopts
 * it as its own; any other row tracks it as an external shipment, never
 * canceled or paid from here.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const shipmentId = String(bodyOf(req).shipmentId ?? "").trim()
  await respondParcel(req, res, () => linkShipment(req.scope, req.params.id, shipmentId, actorOf(req)))
}
