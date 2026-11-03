import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { WithdrawResponse } from "../../../../../../modules/dpd/lib/contract"
import { toShipmentDto } from "../../../../../../modules/dpd/lib/dto"
import { withdrawShipment } from "../../../../../../workflows/dpd/dispatch"
import { actorOf, dispatchDtos, noStore, sendError, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/withdraw  {}  ->  WithdrawResponse
 *
 * Takes a shipment out of its dispatch: locally from pending and printed
 * (writer shipment), through a change of the courier order (or its
 * cancellation for the last shipment) from ordered (writer pickup).
 * withdrawn false: DPD refused or did not answer; dispatch.errorCode says
 * why.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const result = await withdrawShipment(req.scope, shipmentIdOf(req), { actor: actorOf(req) })
    const [dispatch] = await dispatchDtos(req.scope, [result.dispatch])
    const body: WithdrawResponse = { shipment: toShipmentDto(result.shipment), dispatch, withdrawn: result.withdrawn, warnings: result.warnings }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
