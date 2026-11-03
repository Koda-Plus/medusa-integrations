import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CreateDispatchRequest, DispatchFilter, DispatchesResponse } from "../../../../modules/dpd/lib/contract"
import { createDispatch } from "../../../../workflows/dpd/dispatch"
import { storeFor } from "../../../../workflows/dpd/runtime"
import { ActionError, actorOf, bodyOf, dispatchDtos, dpdService, intParam, noStore, respondDispatch, sendError, shipmentIdsOf, strParam } from "../helpers"

const FILTERS: readonly string[] = ["open", "attention", "all"]

function isDispatchFilter(v: string): v is DispatchFilter {
  return FILTERS.includes(v)
}

/**
 * GET /admin/dpd/dispatches?filter=open|attention|all&offset=0&limit=20  ->  DispatchesResponse
 *
 * One page of the dispatches of the current mode, newest first, with their
 * current shipments and the counts of open and attention dispatches. Reads
 * our database only: no DPD call, no write, no lease expiry (the pass does
 * that, DS8).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const raw = strParam(req.query.filter)
    if (raw && !isDispatchFilter(raw)) throw new ActionError(400, "invalid", "filter is open, attention or all.")
    const filter: DispatchFilter = raw && isDispatchFilter(raw) ? raw : "open"
    const limit = intParam(req.query.limit, 20, 1, 100)
    const offset = intParam(req.query.offset, 0, 0, 100_000)
    const mode = dpdService(req.scope).mode()
    const store = storeFor(req.scope)
    const { rows, count } = await store.listDispatches({ mode, filter, offset, limit })
    const counts = await store.dispatchCounts(mode)
    const body: DispatchesResponse = { dispatches: await dispatchDtos(req.scope, rows), count, offset, limit, open: counts.open, attention: counts.attention }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}

/**
 * POST /admin/dpd/dispatches  { shipmentIds, planHash, print? }  ->  DispatchResponse
 *
 * Creates a dispatch from the plan the person read (the hash must still
 * match), and with print: true prints the protocol in the same click. Needs
 * the armed shipment writer, also without print. A refused print (an
 * ActionError) is not an error of this route: the dispatch exists, so the
 * answer is the dispatch. Any other error of the print is a 500.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => {
    const body = bodyOf(req)
    const shipmentIds = shipmentIdsOf(body)
    const planHash = typeof body.planHash === "string" ? body.planHash.trim() : ""
    if (!planHash) throw new ActionError(400, "plan_hash_missing", "Read the plan first and send its planHash.")
    if (body.print !== undefined && typeof body.print !== "boolean") throw new ActionError(400, "invalid", "print is true or false.", [{ index: 0, field: "print" }])
    const request: CreateDispatchRequest = { shipmentIds, planHash, print: body.print === true }
    return createDispatch(req.scope, request, { actor: actorOf(req) })
  })
}
