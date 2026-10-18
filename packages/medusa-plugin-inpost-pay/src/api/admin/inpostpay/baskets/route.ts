import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BASKET_STATUSES } from "../../../../modules/inpostpay/lib/constants"
import type { BasketsResponse } from "../../../../modules/inpostpay/lib/contract"
import { inpostPaySvc, PAYMENT_PROBLEMS, toBasketDto } from "../../../../modules/inpostpay/lib/store"
import { displayIds, ordersByNumber } from "../../../inpostpay/admin-helpers"

/**
 * GET /admin/inpostpay/baskets?filter=&q=&limit=&offset=: the bound baskets,
 * newest first. `filter`: a status, or `payment_problems`. `q`: a basket,
 * cart or order id, or an order number. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = inpostPaySvc(req.scope)
  const filter = String(req.query.filter ?? "all")
  const q = String(req.query.q ?? "").trim().slice(0, 100)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const filters: Record<string, unknown> = {}
  if ((BASKET_STATUSES as readonly string[]).includes(filter)) filters.status = filter
  if (filter === "payment_problems") filters.payment_status = [...PAYMENT_PROBLEMS]
  if (q) {
    if (/^ipbsk_/.test(q)) filters.id = q
    else if (/^cart_/.test(q)) filters.cart_id = q
    else if (/^order_/.test(q)) filters.order_id = q
    else if (/^#?\d+$/.test(q)) filters.order_id = [...(await ordersByNumber(req, q)), "order_none"]
    else filters.id = "ipbsk_none"
  }
  const [rows, count] = await svc.listAndCountInpostPayBaskets(filters, { take: limit, skip: offset, order: { created_at: "DESC" } })
  const list = rows as Array<Record<string, any>>
  const ids = await displayIds(req, list.map((r) => r.order_id).filter((x): x is string => typeof x === "string"))
  const body: BasketsResponse = {
    baskets: list.map((r) => toBasketDto(r, r.order_id ? (ids.get(r.order_id) ?? null) : null)),
    count: Number(count) || 0,
    offset,
    limit,
  }
  res.json(body)
}
