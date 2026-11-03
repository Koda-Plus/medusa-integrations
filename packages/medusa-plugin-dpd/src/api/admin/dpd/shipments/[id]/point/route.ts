import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PlanResponse } from "../../../../../../modules/dpd/lib/contract"
import { toPlanDto, toShipmentDto } from "../../../../../../modules/dpd/lib/dto"
import { changePoint } from "../../../../../../workflows/dpd/points"
import { isArmed, pointsFor, settingsOf } from "../../../../../../workflows/dpd/runtime"
import { actorOf, bodyOf, dpdService, noStore, sendError, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/point  { "pudoId": "PL14509" }  ->  PlanResponse
 *
 * Changes the DPD Pickup point of a shipment not created yet (pending,
 * failed). The point is checked now and never accepted unchecked: 502 or 503
 * points_unavailable when it cannot be, 422 point_refused with the problems
 * of the point (not there, not active, not handing out parcels, no cash on
 * delivery for a COD shipment, abroad). Answers the fresh plan. Nothing goes
 * to DPD and no armed writer is needed; the order keeps the point the
 * customer chose, and the plugin does not tell the customer: a person does.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const svc = dpdService(req.scope)
    const raw = bodyOf(req).pudoId
    const { row, plan } = await changePoint(req.scope, shipmentIdOf(req), typeof raw === "string" ? raw : "", actorOf(req))
    const answer: PlanResponse = {
      shipment: toShipmentDto(row),
      plan: toPlanDto(plan, pointsFor(req.scope).kind),
      writerArmed: await isArmed(svc, "shipment"),
      mode: svc.mode(),
      labelPage: (await settingsOf(svc)).labelPage,
    }
    res.json(answer)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
