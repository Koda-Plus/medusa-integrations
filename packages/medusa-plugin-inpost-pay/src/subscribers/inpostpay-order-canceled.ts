import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { notifyInpost } from "../workflows/inpostpay/orders"

/**
 * `order.canceled`: tell InPost Pay the order was rejected by the store
 * (ORDER_REJECTED), so the app shows it. Only orders that came through
 * InPost Pay, only with `sendOrderEvents` (simulated in demo mode). Never
 * throws: the cancel in Medusa must not fail because of InPost.
 */
export default async function inpostPayOrderCanceled({ event, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const id = event.data?.id
  if (typeof id !== "string") return
  await notifyInpost(container, id, { kind: "canceled" }).catch(() => undefined)
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "inpostpay-order-canceled" },
}
