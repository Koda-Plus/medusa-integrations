import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onOrderCanceled } from "../workflows/emails/events"

/** Cancellation (`order.canceled`), with the same skip rules as the confirmation. Never throws. */
export default async function emailsOrderCanceled({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onOrderCanceled(container, data.id)
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "emails-order-canceled" },
}
