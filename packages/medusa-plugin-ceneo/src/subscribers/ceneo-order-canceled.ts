import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ceneoSvc } from "../modules/ceneo/lib/store"
import { queueCancel } from "../workflows/ceneo/import-orders"
import { errorText } from "../workflows/ceneo/runtime"

/**
 * The store cancelled an order imported from Ceneo: the cancellation waits
 * for the status writer. Not when Ceneo cancelled it first (its state is in
 * `orders.canceledStates`): nothing goes back. A no-op for any other order.
 * Never throws.
 */
export default async function ceneoOrderCanceled({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  try {
    await queueCancel(container, data.id)
  } catch (err) {
    ceneoSvc(container).getLogger().error(`[ceneo] order.canceled ${data.id}: ${errorText(err)}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "ceneo-order-canceled" },
}
