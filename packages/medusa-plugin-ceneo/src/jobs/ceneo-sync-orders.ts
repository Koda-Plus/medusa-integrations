import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDERS_JOB_SCHEDULE } from "../modules/ceneo/lib/constants"
import { importCeneoOrdersWorkflow, syncCeneoOrdersWorkflow } from "../workflows/ceneo/workflows"

/**
 * KUP TERAZ ORDERS, EVERY 5 MINUTES: read from Ceneo into the plugin's
 * table, then the writers: the import into Medusa and what Ceneo should
 * learn, each only when armed. Without an API key (and without demo) it
 * does nothing.
 */
export default async function ceneoSyncOrdersJob(container: MedusaContainer): Promise<void> {
  await syncCeneoOrdersWorkflow(container).run({ input: { trigger: "schedule" } })
  await importCeneoOrdersWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "ceneo-sync-orders",
  schedule: ORDERS_JOB_SCHEDULE,
}
