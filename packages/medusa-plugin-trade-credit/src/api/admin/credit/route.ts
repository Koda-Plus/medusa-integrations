import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { creditSvc, toCreditOrder, toLimit } from "../../../modules/credit/lib/store"
import type { StatusResponse } from "../../../modules/credit/lib/contract"

/**
 * GET /admin/credit
 *
 * The whole status of the Credit page in one call: the limits, the open and
 * overdue credit orders and the counters.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = creditSvc(req.scope)
  const options = svc.getOptions()
  const [limits, orders] = await Promise.all([
    svc.listCreditLimits({}, { take: 500, order: { used_amount: "DESC" } }),
    svc.listCreditOrders({ state: ["open", "overdue"] }, { take: 100, order: { due_at: "ASC" } }),
  ])
  const limitDtos = limits.map(toLimit)
  const orderDtos = orders.map(toCreditOrder)

  const status: StatusResponse = {
    demo: options.demo,
    enforce: options.enforce,
    counts: {
      limits: limitDtos.length,
      blocked: limitDtos.filter((l) => l.blocked).length,
      exhausted: limitDtos.filter((l) => l.exhausted).length,
      overdue: orderDtos.filter((o) => o.state === "overdue").length,
      used_total: limitDtos.reduce((n, l) => n + l.used_amount, 0),
    },
    limits: limitDtos,
    orders: orderDtos,
  }

  res.json(status)
}
