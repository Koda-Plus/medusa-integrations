import type { MedusaContainer } from "@medusajs/framework/types"
import { earnForOrder } from "../workflows/loyalty/account"

/**
 * An order placed by a customer awards points: the total times the points
 * per unit of the store, scaled by the customer's tier multiplier. Orders
 * imported from a marketplace are skipped (the marketplace confirmed the
 * order, not our store); the earning is idempotent per order.
 */
export default async function loyaltyOrderPlaced({ event, container }: { event: { data?: Record<string, unknown> }; container: MedusaContainer }): Promise<void> {
  try {
    const data = event.data ?? {}
    const customerId = typeof data.customer_id === "string" ? data.customer_id : ""
    const orderId = typeof data.id === "string" ? data.id : ""
    const total = typeof data.total === "number" ? data.total : 0
    const metadata = (data.metadata ?? {}) as Record<string, unknown>
    if (!customerId || !orderId || total <= 0) return
    if (metadata.marketplace_order_ref) return
    await earnForOrder(container, { customerId, orderId, orderTotal: total })
  } catch (err) {
    console.warn(`[loyalty] order.placed skipped: ${(err as Error).message}`)
  }
}

export const config = {
  event: "order.placed",
}
