import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, PRICES_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { pushAllegroPricesWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * PRICE PUSH, ONCE AN HOUR (after the offer sync). Always plans; applies
 * only when the prices writer is armed. Quiet when not configured.
 */
export default async function allegroPushPricesJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await pushAllegroPricesWorkflow(container).run({ input: { trigger: "schedule", mode: "auto" } })
}

export const config = {
  name: "allegro-push-prices",
  schedule: PRICES_SCHEDULE,
}
