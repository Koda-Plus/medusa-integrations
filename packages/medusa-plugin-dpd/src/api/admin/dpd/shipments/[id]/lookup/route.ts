import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { lookupShipment } from "../../../../../../workflows/dpd/resolve"
import { actorOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/lookup  {}  ->  ActionResponse
 *
 * Checks an unclear shipment (unknown, abandoned_unknown, without waybills)
 * in DPD by its reference: found, its waybills and label are taken over;
 * not found, it goes back to pending (canceled when its fulfillment is).
 * Needs the armed shipment writer (the lookup advises the parcels) and runs
 * only after the row settled (409 too_early with the seconds to wait).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, () => lookupShipment(req.scope, shipmentIdOf(req), { actor: actorOf(req), trigger: "manual" }))
}
