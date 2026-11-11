import type { MedusaContainer } from "@medusajs/framework/types"
import { CATEGORY_JOB_SCHEDULE } from "../modules/ceneo/lib/constants"
import { syncCeneoCategoriesWorkflow } from "../workflows/ceneo/workflows"

/**
 * THE CENEO CATEGORY TREE, ONCE A DAY (at 03:20). Public data, no key:
 * the mapping in the admin searches it, the feed writes its paths. A
 * failed download keeps the previous tree.
 */
export default async function ceneoSyncCategoriesJob(container: MedusaContainer): Promise<void> {
  await syncCeneoCategoriesWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "ceneo-sync-categories",
  schedule: CATEGORY_JOB_SCHEDULE,
}
