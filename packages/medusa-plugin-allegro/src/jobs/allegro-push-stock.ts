import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, STOCK_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { pushAllegroStockWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * STOCK PUSH, EVERY FIFTEEN MINUTES. Always plans (a dry run the admin
 * shows); applies only when the stock writer is armed, both switches on.
 * Quiet when not configured or not connected.
 */
export default async function allegroPushStockJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await pushAllegroStockWorkflow(container).run({ input: { trigger: "schedule", mode: "auto" } })
}

export const config = {
  name: "allegro-push-stock",
  schedule: STOCK_SCHEDULE,
}
