import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DispatchPlanResponse } from "../../../../modules/dpd/lib/contract"
import { courierOrdersOf } from "../../../../modules/dpd/lib/courier"
import { toDispatchPlanDto } from "../../../../modules/dpd/lib/dto"
import { planDispatch } from "../../../../workflows/dpd/dispatch"
import { bodyOf, dpdService, noStore, sendError, shipmentIdsOf, writersDto } from "../helpers"

/**
 * POST /admin/dpd/dispatch-plan  { shipmentIds }  ->  DispatchPlanResponse
 *
 * The plan of a dispatch before it exists: the shipments, their sender
 * groups, the boxes, the problems and the hash the create sends back. Reads
 * the rows and the fulfillments now; no writer, no DPD call, no write. A
 * plan with problems answers 200 too. POST because up to 500 ids do not fit
 * a query string safely.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const svc = dpdService(req.scope)
    const ids = shipmentIdsOf(bodyOf(req))
    const { plan } = await planDispatch(req.scope, ids)
    const body: DispatchPlanResponse = {
      plan: toDispatchPlanDto(plan),
      mode: svc.mode(),
      writers: await writersDto(req.scope),
      courierOrders: courierOrdersOf(svc.getOptions()),
    }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
