import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, ORDERS_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { syncAllegroOrdersWorkflow } from "../workflows/allegro/sync-allegro-orders"

/**
 * ALLEGRO ORDER JOURNAL, EVERY TEN MINUTES. Reads only the orders changed
 * since the last complete read, usually one request. Quiet when the journal
 * is off (`ordersEnabled: false`), not configured or not connected.
 */
export default async function allegroSyncOrdersJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const o = svc.getOptions()
  if (!o.ordersEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await syncAllegroOrdersWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "allegro-sync-orders",
  schedule: ORDERS_SCHEDULE,
}
