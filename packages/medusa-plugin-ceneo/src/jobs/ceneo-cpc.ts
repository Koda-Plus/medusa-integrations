import type { MedusaContainer } from "@medusajs/framework/types"
import { CPC_JOB_SCHEDULE } from "../modules/ceneo/lib/constants"
import { runCeneoCpcWorkflow } from "../workflows/ceneo/workflows"

/**
 * CPC, EVERY HOUR: bids and the top 10 of the feed offers read from Ceneo,
 * then one planned bid step and the changed promotion texts, each only when
 * its writer is armed. Without an API key (and without demo) it does nothing.
 */
export default async function ceneoCpcJob(container: MedusaContainer): Promise<void> {
  await runCeneoCpcWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "ceneo-cpc",
  schedule: CPC_JOB_SCHEDULE,
}
