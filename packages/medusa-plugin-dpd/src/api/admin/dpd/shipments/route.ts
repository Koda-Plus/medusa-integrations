import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ShipmentsResponse } from "../../../../modules/dpd/lib/contract"
import { countsOf, toShipmentDto } from "../../../../modules/dpd/lib/dto"
import { storeFor } from "../../../../workflows/dpd/runtime"
import { dpdService, intParam, isFilter, refuse, sendError, strParam } from "../helpers"

/**
 * GET /admin/dpd/shipments?filter=to_create&q=&limit=20&offset=0  ->  ShipmentsResponse
 *
 * One page of a Panel list of the current mode (to_create, labeled,
 * handed_over, in_transit, delivered, problems, canceled, returns, all),
 * newest first, with a search over the order number, the order and
 * fulfillment ids, the waybills, the Pickup point and the reference, and the
 * counts for the filter buttons. Reads only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const raw = strParam(req.query.filter)
    if (raw && !isFilter(raw)) {
      refuse(res, 400, "invalid", "filter is all or one of the Panel lists: to_create, labeled, handed_over, in_transit, delivered, problems, canceled, returns.")
      return
    }
    const filter = isFilter(raw) ? raw : "all"
    const limit = intParam(req.query.limit, 20, 1, 100)
    const offset = intParam(req.query.offset, 0, 0, 100_000)
    const mode = dpdService(req.scope).mode()
    const store = storeFor(req.scope)
    const { rows, count } = await store.list({ mode, filter, q: strParam(req.query.q), offset, limit })
    const body: ShipmentsResponse = { shipments: rows.map((r) => toShipmentDto(r)), count, offset, limit, counts: countsOf(await store.counts(mode)) }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
