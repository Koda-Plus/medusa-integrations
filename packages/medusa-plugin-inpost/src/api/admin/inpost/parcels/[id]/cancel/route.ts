import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelShipment } from "../../../../../../workflows/inpost/parcels"
import { actorOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/cancel
 *
 * Cancels a shipment in ShipX while ShipX still allows it (created, offers
 * prepared, offer selected; the status is read again first). Later, the
 * answer says to cancel it in InPost Manager (lockers) or WebTrucker
 * (courier). Needs the shipment writer armed. Shipments the plugin did not
 * create are never canceled from here.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondParcel(req, res, () => cancelShipment(req.scope, req.params.id, actorOf(req)))
}
