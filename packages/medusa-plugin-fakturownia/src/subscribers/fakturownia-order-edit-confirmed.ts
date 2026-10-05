import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onOrderEditConfirmed } from "../workflows/fakturownia/events"

/**
 * An order edit was confirmed (quantities, prices, lines or shipping
 * changed): when the order's invoice is issued, a correction plan is computed
 * for a person to approve. Nothing is sent to Fakturownia here.
 */
export default async function fakturowniaOrderEditConfirmed({
  event: { data },
  container,
}: SubscriberArgs<{ order_id: string; actions?: Array<{ order_change_id?: string | null; id?: string | null }> }>): Promise<void> {
  if (!data?.order_id) return
  const action = Array.isArray(data.actions) ? data.actions.find((a) => a?.order_change_id || a?.id) : undefined
  await onOrderEditConfirmed(container, data.order_id, action?.order_change_id ?? action?.id ?? null)
}

export const config: SubscriberConfig = {
  event: "order-edit.confirmed",
  context: { subscriberId: "fakturownia-order-edit-confirmed" },
}
