import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { groupAvailability } from "../../../../workflows/dpd/dispatch"
import { ActionError, bodyOf, noStore, sendError, shipmentIdsOf } from "../helpers"

/**
 * POST /admin/dpd/courier-availability  { shipmentIds, groupKey }  ->  AvailabilityResponse
 *
 * The courier windows for the sender of one group of a plan, before the
 * dispatch exists (13.1a). One DPD read (in demo the sample ranges); no
 * writer, nothing stored, no history.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const body = bodyOf(req)
    const shipmentIds = shipmentIdsOf(body)
    const groupKey = typeof body.groupKey === "string" ? body.groupKey.trim() : ""
    if (!groupKey) throw new ActionError(400, "invalid", "groupKey is the key of a sender group of the plan.", [{ index: 0, field: "groupKey" }])
    res.json(await groupAvailability(req.scope, { shipmentIds, groupKey }))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
