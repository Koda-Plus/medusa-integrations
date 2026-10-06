import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onCustomerCreated } from "../workflows/emails/events"

/** Welcome (`customer.created`), for registered accounts only: guests created at checkout get nothing. Never throws. */
export default async function emailsCustomerCreated({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onCustomerCreated(container, data.id)
}

export const config: SubscriberConfig = {
  event: "customer.created",
  context: { subscriberId: "emails-customer-created" },
}
