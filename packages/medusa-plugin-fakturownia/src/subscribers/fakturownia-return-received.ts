import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onReturnReceived } from "../workflows/fakturownia/events"

/**
 * A return was received: when the order's VAT invoice is issued, a
 * correction plan is computed (the returned goods, and the refund that pays
 * them back) for a person to approve in the admin. For a receipt the plan is
 * manual: the return goes into the register of returns. Nothing is sent to
 * Fakturownia here, and the event is never failed.
 */
export default async function fakturowniaReturnReceived({ event: { data }, container }: SubscriberArgs<{ order_id: string; return_id?: string }>): Promise<void> {
  if (!data?.order_id) return
  await onReturnReceived(container, data.order_id, data.return_id ?? null)
}

export const config: SubscriberConfig = {
  event: "order.return_received",
  context: { subscriberId: "fakturownia-return-received" },
}
