import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { lookupUnknown } from "../../../../../../workflows/inpost/parcels"
import { respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/lookup
 *
 * For a create without a clear answer (`unknown`): looks the shipment up in
 * ShipX by its receiver and reference (a read). Found once: adopted, nothing
 * sent twice. Not found a quarter of an hour after the attempt: `failed`, and
 * a person may try again. The status pass does the same by itself.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondParcel(req, res, () => lookupUnknown(req.scope, req.params.id))
}
