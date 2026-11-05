import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { excludeShipment } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/exclude  {}  ->  ActionResponse
 *
 * Marks a created or labeled outbound shipment outside a dispatch as do not
 * send. DPD cannot cancel a shipment through the API, so nothing goes to
 * DPD; the panel asks for the confirmation. Writer shipment.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, async () => excludeShipment(req.scope, shipmentIdOf(req), { actor: actorOf(req) }))
}
