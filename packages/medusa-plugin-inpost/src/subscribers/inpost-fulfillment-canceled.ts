import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onFulfillmentCanceled } from "../workflows/inpost/parcels"

/**
 * A fulfillment was canceled in Medusa: an InPost shipment not created yet is
 * canceled with it. A shipment already in ShipX stays as it is and is flagged
 * in the admin, with "Cancel in InPost" while ShipX still allows it: the
 * plugin never cancels a real shipment by itself.
 */
export default async function inpostFulfillmentCanceled({ event: { data }, container }: SubscriberArgs<{ order_id: string; fulfillment_id: string }>): Promise<void> {
  if (!data?.fulfillment_id) return
  await onFulfillmentCanceled(container, data.fulfillment_id)
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_canceled",
  context: { subscriberId: "inpost-fulfillment-canceled" },
}
