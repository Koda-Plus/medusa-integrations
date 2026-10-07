import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buyOffer } from "../../../../../../workflows/inpost/parcels"
import { actorOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/buy
 *
 * Pays a shipment of a prepaid account that waits in `offers_prepared`: the
 * offer of the shipment's service is bought (POST /v1/shipments/:id/buy).
 * Once per ten minutes per shipment, whoever asks. Needs the shipment writer
 * armed; with it armed the status pass and the webhook do this by themselves,
 * as the plan said.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondParcel(req, res, () => buyOffer(req.scope, req.params.id, { actor: actorOf(req), trigger: "manual" }))
}
