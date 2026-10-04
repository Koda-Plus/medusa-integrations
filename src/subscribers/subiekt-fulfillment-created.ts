import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ORDER_METADATA } from "../modules/subiekt/lib/constants"
import { queryOf, subiektService } from "../workflows/subiekt/runtime"
import { enqueueTask, kickTasks } from "../workflows/subiekt/tasks"

/**
 * With `issueWzOnFulfillment`, a fulfillment created in Medusa asks the
 * bridge for a WZ. Fulfillments the plugin itself created from a WZ carry
 * the WZ number in their metadata and are skipped, so the two directions
 * never chase each other.
 */
export default async function subiektFulfillmentCreated({
  event: { data },
  container,
}: SubscriberArgs<{ order_id: string; fulfillment_id: string; no_notification?: boolean }>): Promise<void> {
  const svc = subiektService(container)
  const o = svc.getOptions()
  if (!o.issueWzOnFulfillment) return
  if (!o.demo && !svc.isConfigured()) return
  if (!data?.order_id || !data?.fulfillment_id) return
  try {
    const { data: fulfillments } = await queryOf(container).graph({
      entity: "fulfillment",
      fields: ["id", "metadata"],
      filters: { id: data.fulfillment_id },
    })
    const meta = ((fulfillments[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata ?? {}) as Record<string, unknown>
    if (meta[ORDER_METADATA.wzNumber]) return

    const { data: orders } = await queryOf(container).graph({ entity: "order", fields: ["id", "display_id"], filters: { id: data.order_id } })
    const displayId = (orders[0] as { display_id?: number } | undefined)?.display_id ?? null
    await enqueueTask(container, {
      kind: "order.fulfill",
      orderId: data.order_id,
      displayId,
      reference: data.fulfillment_id,
      status: "pending",
      trigger: "fulfillment",
    })
    kickTasks(container, "event")
  } catch (err) {
    svc.getLogger().error(`[subiekt] order.fulfillment_created ${data.order_id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
  context: { subscriberId: "subiekt-nexo-fulfillment-created" },
}
