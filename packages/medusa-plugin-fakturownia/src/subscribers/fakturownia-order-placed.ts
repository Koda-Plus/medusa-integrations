import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onOrderPlaced } from "../workflows/fakturownia/events"

/**
 * A placed order: with `trigger: "order_placed"` (or a payment captured
 * already at checkout) its first document is QUEUED, and the outbox issues it
 * in the background. It never fails the order: Fakturownia being down only
 * makes the queue longer.
 *
 * ORDER MATTERS: first the cheap insert into our own table, then the
 * attempt. The other way round, a crash before the insert would lose the
 * document without a trace (the local event bus only logs a failed
 * subscriber).
 */
export default async function fakturowniaOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onOrderPlaced(container, data.id)
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "fakturownia-order-placed" },
}
