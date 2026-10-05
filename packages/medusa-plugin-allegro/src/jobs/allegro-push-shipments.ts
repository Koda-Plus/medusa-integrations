import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, SHIPPING_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { pushAllegroShipmentsWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * PARCELS AND SELLER STATUS, EVERY FIVE MINUTES: sends the outbox rows the
 * fulfillment subscribers queued, once each, retrying only what is
 * transient. Only while the shipping writer is armed.
 */
export default async function allegroPushShipmentsJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await pushAllegroShipmentsWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "allegro-push-shipments",
  schedule: SHIPPING_SCHEDULE,
}
