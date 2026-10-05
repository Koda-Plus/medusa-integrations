import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, PUBLISH_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { publishAllegroOffersWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * PUBLISH BY EAN, ONCE AN HOUR: plans draft offers for variants with an EAN
 * and no offer; creates the drafts only when the publish writer is armed.
 */
export default async function allegroPublishOffersJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await publishAllegroOffersWorkflow(container).run({ input: { trigger: "schedule", mode: "auto" } })
}

export const config = {
  name: "allegro-publish-offers",
  schedule: PUBLISH_SCHEDULE,
}
