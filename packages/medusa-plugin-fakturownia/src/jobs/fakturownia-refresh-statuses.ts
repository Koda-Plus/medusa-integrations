import type { MedusaContainer } from "@medusajs/framework/types"
import { STATUSES_SCHEDULE } from "../modules/fakturownia/lib/constants"
import { fakturowniaService } from "../workflows/fakturownia/runtime"
import { refreshFakturowniaStatusesWorkflow } from "../workflows/fakturownia/refresh-fakturownia-statuses"

/**
 * KSeF STATUS AND WHAT HAD TO WAIT, EVERY 15 MINUTES.
 *
 * Fifteen minutes, not two: KSeF assigns numbers within minutes, and nobody
 * reads a KSeF number on the order page the second it arrives. The pass is
 * read only towards Fakturownia except for e-mails waiting for a KSeF number
 * and proforma rejections that failed earlier, and quiet when nothing changed.
 */
export default async function fakturowniaRefreshStatusesJob(container: MedusaContainer): Promise<void> {
  const svc = fakturowniaService(container)
  if (!svc.isConfigured()) return
  await refreshFakturowniaStatusesWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "fakturownia-refresh-statuses",
  schedule: STATUSES_SCHEDULE,
}
