import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderFilter, OrdersResponse } from "../../../../modules/vonhalsky/lib/contract"
import { orderFilter, toOrderDto, vonHalskySvc } from "../../../../modules/vonhalsky/lib/store"
import { intParam, searchParam } from "../../../vonhalsky/admin-helpers"

const FILTERS: OrderFilter[] = ["all", "awaiting_shipment", "tracking_sent", "held", "errors"]

/**
 * GET /admin/vonhalsky/orders?filter=&q=&offset=&limit=: the marketplace
 * orders and the Medusa orders they became, newest first. `q` finds a
 * marketplace order id, a Medusa order id or an order number. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = vonHalskySvc(req.scope)
  const filter = FILTERS.includes(String(req.query.filter) as OrderFilter) ? (String(req.query.filter) as OrderFilter) : "all"
  const q = searchParam(req.query.q)
  const limit = intParam(req.query.limit, 50, 1, 200)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const base = orderFilter(filter)
  let filters: Record<string, unknown> = base
  if (q) {
    const n = Number(q.replace("#", ""))
    const or: Array<Record<string, unknown>> = [{ marketplace_order_id: { $ilike: `%${q}%` } }, { order_id: q }]
    if (Number.isInteger(n) && n > 0) or.push({ display_id: n })
    filters = Object.keys(base).length > 0 ? { $and: [base, { $or: or }] } : { $or: or }
  }
  const [rows, count] = await svc.listAndCountVonHalskyOrders(filters, { skip: offset, take: limit, order: { created_at: "DESC" } })
  const body: OrdersResponse = { orders: (rows as any[]).map((r) => toOrderDto(r)), count: Number(count) || 0, offset, limit }
  res.json(body)
}
