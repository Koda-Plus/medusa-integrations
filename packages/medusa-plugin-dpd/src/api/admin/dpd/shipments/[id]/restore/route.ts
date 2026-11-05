import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { restoreShipment } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/restore  {}  ->  ActionResponse
 *
 * Takes back do not send: labeled when a label is stored, else created.
 * Writer shipment.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, async () => restoreShipment(req.scope, shipmentIdOf(req), { actor: actorOf(req) }))
}
