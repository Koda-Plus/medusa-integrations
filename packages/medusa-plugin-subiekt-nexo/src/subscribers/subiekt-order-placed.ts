import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { queueOrderCreate } from "../workflows/subiekt/catch-up"
import { subiektService } from "../workflows/subiekt/runtime"
import { kickTasks } from "../workflows/subiekt/tasks"

/**
 * A new order becomes a ZK task. Paid on delivery, by transfer or on credit:
 * due now. Prepaid (card, BLIK, Przelewy24...) and not captured yet: the task
 * waits, `payment.captured` releases it.
 *
 * Without configuration nothing is queued, so a store that installs the
 * plugin and configures it a week later does not flood Subiekt with a week
 * of old orders.
 *
 * When this fails (or the event never arrives), the safety net job
 * `subiekt-catch-up` queues the same task with the same rule a few minutes
 * later (`catchUpEnabled`, on by default).
 */
export default async function subiektOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const svc = subiektService(container)
  if (!svc.isDemo() && !svc.isConfigured()) return
  try {
    const queued = await queueOrderCreate(container, data.id, "placed")
    if (queued?.ready) kickTasks(container, "event")
  } catch (err) {
    svc.getLogger().error(`[subiekt] order.placed ${data.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "subiekt-nexo-order-placed" },
}
