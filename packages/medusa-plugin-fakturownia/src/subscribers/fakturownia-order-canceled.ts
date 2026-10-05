import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onOrderCanceled } from "../workflows/fakturownia/events"

/**
 * A canceled order: queued documents are canceled; with
 * `cancelOnOrderCanceled` (default) an issued proforma is rejected in
 * Fakturownia and an issued VAT invoice or receipt is flagged
 * `needs_correction` for a person. Nothing is ever corrected automatically.
 */
export default async function fakturowniaOrderCanceled({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onOrderCanceled(container, data.id)
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "fakturownia-order-canceled" },
}
