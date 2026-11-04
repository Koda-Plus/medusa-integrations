import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refreshShipmentStatus } from "../../../../../../workflows/dpd/statuses"
import { actorOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/refresh-status  {}  ->  ActionResponse
 *
 * Asks DPD (InfoServices in live, the status simulator in demo and sandbox)
 * for the events of every waybill of the shipment now, outside the queue and
 * its spacing, and applies them as the status pass does: the history, the
 * stage, the events and, when the fulfillmentStatus writer is armed, the
 * write to Medusa. Needs no writer of its own.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, () => refreshShipmentStatus(req.scope, shipmentIdOf(req), { actor: actorOf(req) }))
}
