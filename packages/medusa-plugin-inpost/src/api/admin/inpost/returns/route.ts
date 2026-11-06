import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ReturnsResponse } from "../../../../modules/inpost/lib/contract"
import { isReturnFilter, returnFilters, toReturnDto, type ReturnRow } from "../../../../modules/inpost/lib/returns"
import { cleanReturnId, createReturn, methodOf } from "../../../../workflows/inpost/returns"
import { ActionError, actorOf, bodyOf, inpostService, intParam, respondReturn, returnSearchFilter, sendError, strParam } from "../helpers"

/**
 * GET /admin/inpost/returns?filter=all|open|created|attention|skipped&q=&limit=20&offset=0
 *
 * The InPost returns of the current mode, newest first, with a search over
 * the order number, the tracking number, the drop-off code and the ids.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const filter = isReturnFilter(req.query.filter) ? req.query.filter : "all"
    const limit = intParam(req.query.limit, 20, 1, 100)
    const offset = intParam(req.query.offset, 0, 0, 100_000)
    const where = returnFilters(filter, svc.isDemo())
    const search = returnSearchFilter(strParam(req.query.q))
    const filters = search ? { $and: [where, search] } : where
    const [rows, count] = (await svc.listAndCountInpostParcelReturns(filters as never, { take: limit, skip: offset, order: { created_at: "DESC" } } as never)) as unknown as [ReturnRow[], number]
    const body: ReturnsResponse = { returns: rows.map((r) => toReturnDto(r)), count, limit, offset }
    res.setHeader("Cache-Control", "private, no-store")
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}

/**
 * POST /admin/inpost/returns  { "orderId": "order_...", "returnId": "return_..." | null, "method": "code" | "label", "planHash": "..." }
 *
 * Creates the InPost return of an order (and of a Medusa return, when given),
 * exactly once, from the plan the person read (GET
 * /admin/inpost/orders/:orderId/return-plan): the hash must match the plan of
 * this moment (409 otherwise). Needs the returns writer allowed in the
 * options and armed in Settings (409 otherwise). A second create for the same
 * order and return answers 409. No clear answer from InPost: the row is
 * `unknown`, never sent again by itself. Simulated in demo mode.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const b = bodyOf(req)
  await respondReturn(req, res, async () => {
    const orderId = typeof b.orderId === "string" ? b.orderId.trim() : ""
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(orderId)) throw new ActionError(400, "invalid", 'Send { orderId, returnId?, method?: "code" | "label", planHash }.')
    return createReturn(req.scope, {
      orderId,
      returnId: cleanReturnId(b.returnId),
      method: methodOf(b.method),
      planHash: typeof b.planHash === "string" ? b.planHash : null,
      actor: actorOf(req),
    })
  })
}
