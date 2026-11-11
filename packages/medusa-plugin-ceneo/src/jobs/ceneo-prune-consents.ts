import type { MedusaContainer } from "@medusajs/framework/types"
import { CONSENT_JOB_SCHEDULE } from "../modules/ceneo/lib/constants"
import { ceneoSvc } from "../modules/ceneo/lib/store"
import { pruneConsents } from "../workflows/ceneo/consent"
import { errorText } from "../workflows/ceneo/runtime"

/** Nightly: survey answers older than 90 days go; Ceneo sends the survey within 21 working days. */
export default async function ceneoPruneConsents(container: MedusaContainer): Promise<void> {
  const svc = ceneoSvc(container)
  try {
    const n = await pruneConsents(container)
    if (n > 0) svc.getLogger().info(`[ceneo] Removed ${n} old Zaufane Opinie answers.`)
  } catch (err) {
    svc.getLogger().warn(`[ceneo] Pruning Zaufane Opinie answers failed: ${errorText(err)}`)
  }
}

export const config = {
  name: "ceneo-prune-consents",
  schedule: CONSENT_JOB_SCHEDULE,
}
