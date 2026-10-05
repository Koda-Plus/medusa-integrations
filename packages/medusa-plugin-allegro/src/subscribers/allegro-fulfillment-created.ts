import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ALLEGRO_MODULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { enqueueForOrder, runShipping } from "../workflows/allegro/run-shipping"

/**
 * A fulfillment of an imported Allegro order: its parcels (tracking numbers
 * on the labels) and READY_FOR_SHIPMENT go to the outbox. A no-op for every
 * other order. Never throws: the fulfillment already exists, failing here
 * would not undo it; the shipments job retries what is left.
 */
export default async function allegroFulfillmentCreated({ event: { data }, container }: SubscriberArgs<{ order_id: string; fulfillment_id?: string }>): Promise<void> {
  if (!data?.order_id) return
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  try {
    const queued = await enqueueForOrder(container, data.order_id, "fulfillment")
    if (queued > 0) void runShipping(container, { trigger: "event" }).catch(() => undefined)
  } catch (err) {
    svc.getLogger().error(`[allegro] order.fulfillment_created ${data.order_id}: ${svc.mask(err instanceof Error ? err.message : String(err))}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
  context: { subscriberId: "allegro-fulfillment-created" },
}
