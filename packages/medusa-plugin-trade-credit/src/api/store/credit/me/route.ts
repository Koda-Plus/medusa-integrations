import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { creditSvc, toCreditOrder, toLimit } from "../../../../modules/credit/lib/store"
import { customerIdOf } from "../../../credit/helpers"
import { accountToLimit, storeOrderToDto } from "../../../../modules/credit/lib/store-mode"

/**
 * GET /store/credit/me
 *
 * The logged-in customer's own credit: the limit (with the remaining amount
 * and the terms) and their open credit orders with due dates. Reads only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    res.status(401).json({ type: "unauthorized", code: "unauthorized", message: "Log in to see your credit." })
    return
  }
  const svc = creditSvc(req.scope)
  const store = svc.getOptions?.()?.store
  if (store) {
    const account = (await store.accounts(req.scope)).find((a) => a.customer_id === customerId)
    if (!account) {
      res.status(404).json({ type: "not_found", code: "no_limit", message: "No credit terms set for your company." })
      return
    }
    const orders = await store.orders(req.scope, [customerId])
    res.json({ limit: accountToLimit(account), orders: orders.map(storeOrderToDto) })
    return
  }
  const limits = await svc.listCreditLimits({ customer_id: customerId }, { take: 1 })
  if (limits.length === 0) {
    res.status(404).json({ type: "not_found", code: "no_limit", message: "No credit terms set for your company." })
    return
  }
  const orders = await svc.listCreditOrders({ customer_id: customerId, state: ["open", "overdue"] }, { take: 50, order: { due_at: "ASC" } })
  res.json({ limit: toLimit(limits[0]), orders: orders.map(toCreditOrder) })
}
