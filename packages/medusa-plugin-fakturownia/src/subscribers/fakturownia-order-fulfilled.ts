import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onOrderFulfilled } from "../workflows/fakturownia/events"

/**
 * A fulfillment was created: in the `proforma_then_vat` flow the final
 * document (VAT invoice, or a receipt for a consumer with
 * `receiptForConsumers`) is queued, linked to the proforma. The first
 * fulfillment counts; later ones find the row and do nothing.
 */
export default async function fakturowniaOrderFulfilled({ event: { data }, container }: SubscriberArgs<{ order_id: string; fulfillment_id?: string }>): Promise<void> {
  if (!data?.order_id) return
  await onOrderFulfilled(container, data.order_id)
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
  context: { subscriberId: "fakturownia-order-fulfilled" },
}
