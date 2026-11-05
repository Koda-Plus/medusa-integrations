import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { recordFulfillment } from "../workflows/dpd/shipments"

/**
 * A fulfillment was created: when its provider is DPD (`dpd_*`), the
 * shipment row is recorded, pending (stage 2 builds its plan and creates the
 * shipment when a person asks). Other providers are ignored. Nothing goes to
 * DPD here.
 */
export default async function dpdFulfillmentCreated({ event: { data }, container }: SubscriberArgs<{ order_id: string; fulfillment_id: string }>): Promise<void> {
  if (!data?.order_id || !data?.fulfillment_id) return
  await recordFulfillment(container, data.order_id, data.fulfillment_id)
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
  context: { subscriberId: "dpd-fulfillment-created" },
}
