import type { MedusaContainer } from "@medusajs/framework/types"
import { recordOrder } from "../workflows/credit/orders"

/**
 * An order placed by a customer with credit terms becomes a credit order:
 * the due date follows the customer's net days. Orders of customers without
 * a limit are skipped.
 */
export default async function creditOrderPlaced({ event, container }: { event: { data?: Record<string, unknown> }; container: MedusaContainer }): Promise<void> {
  try {
    const data = event.data ?? {}
    await recordOrder(container, {
      id: typeof data.id === "string" ? data.id : "",
      display_id: typeof data.display_id === "number" ? data.display_id : null,
      customer_id: typeof data.customer_id === "string" ? data.customer_id : null,
      currency_code: typeof data.currency_code === "string" ? data.currency_code : null,
      total: typeof data.total === "number" ? data.total : null,
    })
  } catch (err) {
    console.warn(`[credit] order.placed skipped: ${(err as Error).message}`)
  }
}

export const config = {
  event: "order.placed",
}
