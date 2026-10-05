import type { MedusaContainer } from "@medusajs/framework/types"
import { STATUSES_SCHEDULE } from "../modules/baselinker/lib/constants"
import { canReadStatuses } from "../modules/baselinker/lib/options"
import { baselinkerService } from "../workflows/baselinker/runtime"
import { syncBaseLinkerStatusesWorkflow } from "../workflows/baselinker/sync-baselinker-statuses"

/**
 * STATUS AND TRACKING FROM BASELINKER, EVERY 15 MINUTES.
 *
 * Fifteen minutes, not two: a parcel is handed over by a person at a packing
 * table, so the buyer cannot tell the difference, while the same 100 requests
 * per minute serve the outbox and the catalog. With `customSourceId` one
 * request reads up to 100 of our orders; without it, one request per order,
 * 60 orders per pass at most. Quiet when nothing changed.
 */
export default async function baselinkerSyncStatusesJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  if (!canReadStatuses(svc.getOptions())) return
  await syncBaseLinkerStatusesWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "baselinker-sync-statuses",
  schedule: STATUSES_SCHEDULE,
}
