import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onShipmentCreated } from "../workflows/emails/events"

/**
 * Shipping confirmation (`shipment.created`, `{ id }` is the fulfillment):
 * the tracking numbers and links of its labels. Skipped when the shipment
 * was created with `no_notification`. Never throws.
 */
export default async function emailsOrderShipped({ event: { data }, container }: SubscriberArgs<{ id: string; no_notification?: boolean }>): Promise<void> {
  if (!data?.id) return
  await onShipmentCreated(container, data.id, data.no_notification === true)
}

export const config: SubscriberConfig = {
  event: "shipment.created",
  context: { subscriberId: "emails-order-shipped" },
}
