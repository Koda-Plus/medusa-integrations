import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ParcelDetailResponse } from "../../../../../modules/inpost/lib/contract"
import { toParcelDto } from "../../../../../modules/inpost/lib/dto"
import { actorNames, getParcelOfMode, listEvents } from "../../../../../workflows/inpost/runtime"
import { eventDtos, inpostService, sendError } from "../../helpers"

/**
 * GET /admin/inpost/parcels/:id
 *
 * One shipment with its history: statuses, webhooks, what a person or the
 * plugin did. Rows of the other mode answer 404.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const row = await getParcelOfMode(svc, req.params.id)
    if (!row) {
      res.status(404).json({ code: "not_found", message: "No InPost shipment with this id in the current mode." })
      return
    }
    const events = await listEvents(svc, { parcel_id: row.id }, { take: 100, order: { occurred_at: "DESC" } })
    const parcel = toParcelDto(row)
    /* Who created it: the admin user's e-mail rather than a user id. */
    if (parcel.createdBy) parcel.createdBy = (await actorNames(req.scope, [parcel.createdBy]))[parcel.createdBy] ?? parcel.createdBy
    const body: ParcelDetailResponse = { parcel, events: await eventDtos(req.scope, events) }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
