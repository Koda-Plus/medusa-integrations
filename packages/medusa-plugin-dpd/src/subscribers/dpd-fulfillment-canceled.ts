import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onFulfillmentCanceled } from "../workflows/dpd/shipments"

/**
 * A fulfillment was canceled in Medusa: its DPD shipment, when nothing was
 * sent to DPD yet, is canceled with it. A shipment DPD already has stays as
 * it is and is flagged in the history: DPDServices cannot cancel a
 * shipment, and the plugin never pretends it did. Other providers have no
 * row, so nothing happens for them.
 */
export default async function dpdFulfillmentCanceled({ event: { data }, container }: SubscriberArgs<{ order_id: string; fulfillment_id: string }>): Promise<void> {
  if (!data?.fulfillment_id) return
  await onFulfillmentCanceled(container, data.fulfillment_id)
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_canceled",
  context: { subscriberId: "dpd-fulfillment-canceled" },
}
