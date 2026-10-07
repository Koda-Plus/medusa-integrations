import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parcelSize } from "../../../../../../modules/inpost/lib/options"
import { changeSize } from "../../../../../../workflows/inpost/parcels"
import { ActionError, actorOf, bodyOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/size  { "size": "small" | "medium" | "large" }
 *
 * The parcel size of one shipment not sent yet (A, B or C), over the default
 * of Settings.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const size = parcelSize(bodyOf(req).size)
  await respondParcel(req, res, async () => {
    if (!size) throw new ActionError(400, "bad_size", "Send { size: \"small\" | \"medium\" | \"large\" }.")
    return changeSize(req.scope, req.params.id, size, actorOf(req))
  })
}
