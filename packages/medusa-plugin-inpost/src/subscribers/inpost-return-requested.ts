import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { recordMedusaReturn } from "../workflows/inpost/returns"

/**
 * A Medusa return was requested: when it goes out on the InPost return option
 * (the provider marked its fulfillment), the InPost return row is recorded,
 * pending. Nothing is sent to InPost here: a person reads the plan on the
 * order page and creates the return (the returns writer must be armed).
 * Returns on other options are ignored.
 */
export default async function inpostReturnRequested({ event: { data }, container }: SubscriberArgs<{ order_id: string; return_id: string }>): Promise<void> {
  if (!data?.order_id || !data?.return_id) return
  await recordMedusaReturn(container, data.order_id, data.return_id)
}

export const config: SubscriberConfig = {
  event: "order.return_requested",
  context: { subscriberId: "inpost-return-requested" },
}
