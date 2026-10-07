import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { recordFulfillment } from "../workflows/inpost/parcels"

/**
 * A fulfillment was created: when its provider is InPost, the shipment row is
 * recorded (pending, or skipped for an order shipped outside Medusa). With the
 * shipment writer armed and `autoCreate`, the shipment is created right away;
 * otherwise it waits for a person and its plan. Other providers are ignored.
 */
export default async function inpostFulfillmentCreated({ event: { data }, container }: SubscriberArgs<{ order_id: string; fulfillment_id: string }>): Promise<void> {
  if (!data?.order_id || !data?.fulfillment_id) return
  await recordFulfillment(container, data.order_id, data.fulfillment_id)
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
  context: { subscriberId: "inpost-fulfillment-created" },
}
