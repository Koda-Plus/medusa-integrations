import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { orderReadiness } from "../workflows/subiekt/orders"
import { subiektService } from "../workflows/subiekt/runtime"
import { enqueueTask, kickTasks } from "../workflows/subiekt/tasks"

/**
 * A new order becomes a ZK task. Paid on delivery, by transfer or on credit:
 * due now. Prepaid (card, BLIK, Przelewy24...) and not captured yet: the task
 * waits, `payment.captured` releases it.
 *
 * Without configuration nothing is queued, so a store that installs the
 * plugin and configures it a week later does not flood Subiekt with a week
 * of old orders.
 */
export default async function subiektOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const svc = subiektService(container)
  if (!svc.isDemo() && !svc.isConfigured()) return
  try {
    const order = await orderReadiness(container, data.id)
    if (!order || order.canceled) return
    await enqueueTask(container, {
      kind: "order.create",
      orderId: data.id,
      displayId: order.displayId,
      status: order.ready ? "pending" : "waiting",
      trigger: "placed",
    })
    if (order.ready) kickTasks(container, "event")
  } catch (err) {
    svc.getLogger().error(`[subiekt] order.placed ${data.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "subiekt-nexo-order-placed" },
}
