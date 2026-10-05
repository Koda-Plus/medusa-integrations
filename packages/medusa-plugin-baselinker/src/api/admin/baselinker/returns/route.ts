import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ReturnsResponse } from "../../../../modules/baselinker/lib/contract"
import { toReturnDto, type ReturnRow } from "../../../../modules/baselinker/lib/dto"
import { baselinkerService, intParam, strParam } from "../helpers"

/**
 * GET /admin/baselinker/returns?q=&linked=&limit=&offset=
 *
 * Returns from the BaseLinker return manager (read only), newest first,
 * linked to the Medusa order when the order is one this plugin sent or
 * imported. `q` matches a return id, a BaseLinker order id or a Medusa order
 * number; `linked=1` shows only returns of Medusa orders.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q).replace(/^#/, "").slice(0, 40)
  const and: Array<Record<string, unknown>> = [{ demo: svc.isDemo() }]
  if (strParam(req.query.linked) === "1") and.push({ order_id: { $ne: null } })
  if (q && /^\d+$/.test(q)) and.push({ $or: [{ bl_return_id: q }, { bl_order_id: q }, { display_id: Number(q) }] })
  const [rows, count] = (await svc.listAndCountBaseLinkerReturns({ $and: and } as never, {
    take: limit,
    skip: offset,
    order: { created_in_bl_at: "DESC", bl_return_id: "DESC" },
  } as never)) as unknown as [ReturnRow[], number]
  const body: ReturnsResponse = { returns: rows.map(toReturnDto), count, limit, offset }
  res.json(body)
}
