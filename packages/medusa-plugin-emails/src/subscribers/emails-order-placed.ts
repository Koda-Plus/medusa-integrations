import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onOrderPlaced } from "../workflows/emails/events"

/**
 * Order confirmation (`order.placed`). Skipped for orders with
 * `no_notification`, orders from marketplaces (`marketplace_order_ref`) and
 * orders without an address. Never throws.
 */
export default async function emailsOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onOrderPlaced(container, data.id)
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "emails-order-placed" },
}
