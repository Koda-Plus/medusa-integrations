import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PlanResponse } from "../../../../../../modules/dpd/lib/contract"
import { toPlanDto, toShipmentDto } from "../../../../../../modules/dpd/lib/dto"
import { planForShipment } from "../../../../../../workflows/dpd/plan"
import { isArmed, pointsFor, settingsOf } from "../../../../../../workflows/dpd/runtime"
import { dpdService, noStore, sendError, shipmentIdOf } from "../../../helpers"

/**
 * GET /admin/dpd/shipments/:id/plan  ->  PlanResponse
 *
 * The plan a person reads before a shipment is created: the receiver (read
 * from the order now), the sender, the boxes, the cash on delivery, the
 * reference, the problems and warnings, the exact request to DPD and its
 * hash, which the create sends back. Only for a row not created yet
 * (pending, failed; 409 wrong_state otherwise). Nothing is sent to DPD and
 * nothing about the receiver is stored: the answer is private, no-store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const svc = dpdService(req.scope)
    const { row, plan } = await planForShipment(req.scope, shipmentIdOf(req))
    const body: PlanResponse = {
      shipment: toShipmentDto(row),
      plan: toPlanDto(plan, pointsFor(req.scope).kind),
      writerArmed: await isArmed(svc, "shipment"),
      mode: svc.mode(),
      labelPage: (await settingsOf(svc)).labelPage,
    }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
