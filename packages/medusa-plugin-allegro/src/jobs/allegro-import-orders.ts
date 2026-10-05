import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, IMPORT_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { importAllegroOrdersWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * ORDER IMPORT, EVERY TWO MINUTES. Reads the Allegro order event journal and
 * imports the forms ready for processing, exactly once each. Only while the
 * orders writer is armed: disarmed, the journal is not read and the cursor
 * holds, so nothing is skipped.
 */
export default async function allegroImportOrdersJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await importAllegroOrdersWorkflow(container).run({ input: { trigger: "schedule", mode: "auto" } })
}

export const config = {
  name: "allegro-import-orders",
  schedule: IMPORT_SCHEDULE,
}
