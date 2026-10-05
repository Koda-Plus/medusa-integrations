import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onPaymentRefunded } from "../workflows/fakturownia/events"

/**
 * A payment was refunded (`{ id }` is the payment): the correction plan of
 * the order's issued invoice is computed again. A refund that pays back
 * returned goods belongs to that return's correction; a refund beyond the
 * returned goods is a price reduction spread over the positions. A person
 * approves every plan. Nothing is sent to Fakturownia here.
 */
export default async function fakturowniaPaymentRefunded({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onPaymentRefunded(container, data.id)
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
  context: { subscriberId: "fakturownia-payment-refunded" },
}
