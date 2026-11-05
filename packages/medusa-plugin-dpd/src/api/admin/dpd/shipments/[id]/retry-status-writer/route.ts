import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryStatusWriterRun } from "../../../../../../workflows/dpd/statuses"
import { actorOf, respondShipmentWith, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/retry-status-writer  {}  ->  RetryStatusWriterResponse
 *
 * Writes the DPD status of the shipment to Medusa again after a failed
 * write (statusWriterError set) or a write that stopped after its claim (a
 * writer mark older than WRITER_MARK_STALE_MS while Medusa has no shipped_at
 * or delivered_at): releases such a mark, then marks the fulfillment shipped
 * and, when every waybill is delivered, delivered. Needs the armed
 * fulfillmentStatus writer. Asks DPD nothing; a failed write answers 200
 * with the new error. `result` says what the writer did (E56): only
 * "written" means Medusa has the status.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipmentWith(req, res, async () => {
    const { row, result } = await retryStatusWriterRun(req.scope, shipmentIdOf(req), { actor: actorOf(req) })
    return { row, extra: { result } }
  })
}
