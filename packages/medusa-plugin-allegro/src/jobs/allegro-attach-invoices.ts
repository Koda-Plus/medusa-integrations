import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, INVOICES_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { attachAllegroInvoicesWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * INVOICES, EVERY FIVE MINUTES, ON THEIR OWN SWEEP: never part of the order
 * import, so pausing the import does not stop invoices reaching buyers.
 * Only while the invoices writer is armed.
 */
export default async function allegroAttachInvoicesJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await attachAllegroInvoicesWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "allegro-attach-invoices",
  schedule: INVOICES_SCHEDULE,
}
