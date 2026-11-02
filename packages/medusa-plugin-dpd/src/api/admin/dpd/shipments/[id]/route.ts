import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ShipmentResponse } from "../../../../../modules/dpd/lib/contract"
import { toDocumentDto, toShipmentDto } from "../../../../../modules/dpd/lib/dto"
import { documentsOf } from "../../../../../workflows/dpd/documents"
import { actorNames, getShipmentOfMode, isArmed, listEvents, settingsOf } from "../../../../../workflows/dpd/runtime"
import { ActionError, dpdService, eventDtos, noStore, sendError, shipmentIdOf } from "../../helpers"

/**
 * GET /admin/dpd/shipments/:id  ->  ShipmentResponse
 *
 * One shipment of the current mode with its stored documents (never their
 * bytes), its history, whether the shipment writer is armed and the label
 * page in force. Reads only; a row of another mode answers 404.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const svc = dpdService(req.scope)
    const row = await getShipmentOfMode(svc, shipmentIdOf(req))
    if (!row) throw new ActionError(404, "not_found", "No DPD shipment with this id in the current mode.")
    const documents = await documentsOf(req.scope, row.id)
    const events = await listEvents(svc, { shipment_id: row.id }, { take: 100, order: { occurred_at: "DESC" } })
    const names = await actorNames(req.scope, documents.map((d) => d.created_by))
    const body: ShipmentResponse = {
      shipment: toShipmentDto(row),
      documents: documents.map((d) => toDocumentDto(d, names)),
      events: await eventDtos(req.scope, events),
      writerArmed: await isArmed(svc, "shipment"),
      labelPage: (await settingsOf(svc)).labelPage,
    }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
