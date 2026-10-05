import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ALLEGRO_MODULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { enqueueForOrder, runShipping } from "../workflows/allegro/run-shipping"

/**
 * A shipment (`{ id }` is the fulfillment): its tracking numbers, and SENT
 * once every Allegro line of the order is shipped, go to the outbox. A no-op
 * for orders that did not come from Allegro. Never throws.
 */
export default async function allegroShipmentCreated({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: rows } = await query.graph({ entity: "fulfillment", fields: ["id", "order.id"], filters: { id: data.id } })
    const orderId = (rows as Array<{ order?: { id?: string | null } | null }>)[0]?.order?.id
    if (!orderId) return
    const queued = await enqueueForOrder(container, orderId, "shipment")
    if (queued > 0) void runShipping(container, { trigger: "event" }).catch(() => undefined)
  } catch (err) {
    svc.getLogger().error(`[allegro] shipment.created ${data.id}: ${svc.mask(err instanceof Error ? err.message : String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "shipment.created",
  context: { subscriberId: "allegro-shipment-created" },
}
