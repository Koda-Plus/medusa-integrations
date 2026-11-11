import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDERS_JOB_SCHEDULE } from "../modules/ceneo/lib/constants"
import { syncCeneoOrdersWorkflow } from "../workflows/ceneo/workflows"

/**
 * KUP TERAZ ORDERS, EVERY 5 MINUTES: read from Ceneo into the plugin's
 * table, nothing written to Ceneo or Medusa. Without an API key (and
 * without demo) it does nothing.
 */
export default async function ceneoSyncOrdersJob(container: MedusaContainer): Promise<void> {
  await syncCeneoOrdersWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "ceneo-sync-orders",
  schedule: ORDERS_JOB_SCHEDULE,
}
