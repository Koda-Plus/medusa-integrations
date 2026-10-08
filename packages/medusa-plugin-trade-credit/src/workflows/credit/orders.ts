import type { MedusaContainer } from "@medusajs/framework/types"
import { dueFor, refreshUsed } from "./limits"
import { creditSvc, str } from "../../modules/credit/lib/store"

/** The order fields the flows read from an order.placed event or a seed row. */
export interface PlacedOrder {
  id: string
  display_id?: number | null
  customer_id?: string | null
  currency_code?: string | null
  total?: number | null
}

/**
 * One placed order becomes a credit order when the customer has credit
 * terms: the due date follows the limit's net days. Without a limit nothing
 * is recorded.
 */
export async function recordOrder(container: MedusaContainer, order: PlacedOrder): Promise<void> {
  const customerId = str(order.customer_id)
  if (!customerId) return
  const svc = creditSvc(container)
  const limits = await svc.listCreditLimits({ customer_id: customerId }, { take: 1 })
  if (limits.length === 0) return
  const limit = limits[0]
  const existing = await svc.listCreditOrders({ order_id: order.id }, { take: 1 })
  if (existing.length > 0) return
  const total = typeof order.total === "number" && Number.isFinite(order.total) ? order.total : 0
  await svc.createCreditOrders([
    {
      order_id: order.id,
      display_id: typeof order.display_id === "number" ? order.display_id : null,
      customer_id: customerId,
      currency_code: str(order.currency_code) ?? str(limit.currency_code) ?? "pln",
      total_amount: total,
      net_days: typeof limit.net_days === "number" ? limit.net_days : 0,
      due_at: dueFor(typeof limit.net_days === "number" ? limit.net_days : 0),
      state: "open",
      demo: svc.isDemo(),
    },
  ])
  await refreshUsed(container, customerId)
}
