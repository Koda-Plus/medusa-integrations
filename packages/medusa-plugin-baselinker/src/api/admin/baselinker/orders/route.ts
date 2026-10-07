import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderFilter, OrdersResponse } from "../../../../modules/baselinker/lib/contract"
import { toOrderDto, type OrderRow } from "../../../../modules/baselinker/lib/dto"
import { baselinkerService, guarded, intParam, strParam } from "../helpers"

const FILTERS: readonly OrderFilter[] = ["all", "pending", "sent", "failed", "skipped"]

/**
 * GET /admin/baselinker/orders?filter=&q=&limit=&offset=
 *
 * The order outbox and the way back, newest first. `q` matches the order
 * number (`1042` or `#1042`), a Medusa order id or a BaseLinker order id.
 * Reads only.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const raw = strParam(req.query.filter) as OrderFilter
  const filter: OrderFilter = FILTERS.includes(raw) ? raw : "all"
  const q = strParam(req.query.q).replace(/^#/, "").slice(0, 80)

  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (filter !== "all") where.status = filter
  if (q) {
    if (/^\d+$/.test(q)) where.$or = [{ display_id: Number(q) }, { bl_order_id: q }]
    else where.order_id = q
  }

  const [rows, count] = (await svc.listAndCountBaseLinkerOrders(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)) as unknown as [OrderRow[], number]
  const body: OrdersResponse = { orders: rows.map(toOrderDto), count, limit, offset }
  res.json(body)
})
