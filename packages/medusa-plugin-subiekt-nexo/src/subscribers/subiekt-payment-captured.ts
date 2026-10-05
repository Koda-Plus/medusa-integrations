import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { orderReadiness } from "../workflows/subiekt/orders"
import { queryOf, subiektService } from "../workflows/subiekt/runtime"
import { enqueueTask, kickTasks } from "../workflows/subiekt/tasks"

/**
 * The money arrived: a waiting ZK task becomes due. A partial capture keeps
 * it waiting. When the capture comes before the order exists (some
 * providers capture during checkout), `order.placed` sees the captured
 * payment itself, so nothing is lost either way.
 */
export default async function subiektPaymentCaptured({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  const svc = subiektService(container)
  if (!svc.isDemo() && !svc.isConfigured()) return
  try {
    const { data: payments } = await queryOf(container).graph({
      entity: "payment",
      fields: ["id", "payment_collection.order.id"],
      filters: { id: data.id },
    })
    const orderId = (payments[0] as { payment_collection?: { order?: { id?: string } | null } | null } | undefined)?.payment_collection?.order?.id
    if (!orderId) return

    const order = await orderReadiness(container, orderId)
    if (!order || order.canceled || !order.ready) return
    await enqueueTask(container, { kind: "order.create", orderId, displayId: order.displayId, status: "pending", trigger: "captured" })
    kickTasks(container, "event")
  } catch (err) {
    svc.getLogger().error(`[subiekt] payment.captured ${data.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "payment.captured",
  context: { subscriberId: "subiekt-nexo-payment-captured" },
}
