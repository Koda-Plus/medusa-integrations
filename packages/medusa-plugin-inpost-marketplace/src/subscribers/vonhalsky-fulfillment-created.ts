import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { syncTracking } from "../workflows/vonhalsky/tracking"

/**
 * `order.fulfillment_created`: when the fulfillment provider put tracking
 * numbers on the labels at once (the InPost plugin of Koda Plus does), they
 * go back to the marketplace without waiting for "Mark as shipped". A no-op
 * for orders that did not come from InPost Von Halsky and for fulfillments
 * without numbers. Never throws.
 */
export default async function vonHalskyFulfillmentCreated({ event, container }: SubscriberArgs<{ order_id: string; fulfillment_id?: string }>): Promise<void> {
  const orderId = event.data?.order_id
  if (typeof orderId !== "string") return
  await syncTracking(container, orderId).catch(() => undefined)
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
  context: { subscriberId: "vonhalsky-fulfillment-created" },
}
