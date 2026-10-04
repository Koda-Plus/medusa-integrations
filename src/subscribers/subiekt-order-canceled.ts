import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { queryOf, subiektService } from "../workflows/subiekt/runtime"
import { enqueueCancel, kickTasks } from "../workflows/subiekt/tasks"

/**
 * A canceled order cancels its ZK. When the ZK was never attempted, only the
 * queued create is canceled: nothing exists in Subiekt to touch.
 */
export default async function subiektOrderCanceled({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const svc = subiektService(container)
  if (!svc.isDemo() && !svc.isConfigured()) return
  try {
    const { data: orders } = await queryOf(container).graph({ entity: "order", fields: ["id", "display_id"], filters: { id: data.id } })
    const displayId = (orders[0] as { display_id?: number } | undefined)?.display_id ?? null
    const task = await enqueueCancel(container, data.id, displayId)
    if (task) kickTasks(container, "event")
  } catch (err) {
    svc.getLogger().error(`[subiekt] order.canceled ${data.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
  context: { subscriberId: "subiekt-nexo-order-canceled" },
}
