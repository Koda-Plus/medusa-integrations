import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refreshParcel } from "../../../../../../workflows/inpost/parcels"
import { respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/refresh
 *
 * Reads the shipment from ShipX now (a read) and applies its status: the
 * history, the events and the follow ups happen as after a webhook.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondParcel(req, res, () => refreshParcel(req.scope, req.params.id, "admin"))
}
