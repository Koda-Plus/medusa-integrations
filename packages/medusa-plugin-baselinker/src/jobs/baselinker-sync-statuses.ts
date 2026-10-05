import type { MedusaContainer } from "@medusajs/framework/types"
import { STATUSES_SCHEDULE } from "../modules/baselinker/lib/constants"
import { canReadStatuses } from "../modules/baselinker/lib/options"
import { runStatusPass } from "../workflows/baselinker/journal"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * STATUS AND TRACKING FROM BASELINKER, EVERY 15 MINUTES, for the orders sent
 * to BaseLinker and the marketplace orders imported from it.
 *
 * Fifteen minutes, not two: a parcel is handed over by a person at a packing
 * table, so the buyer cannot tell the difference, while the same 100 requests
 * per minute serve the outbox and the catalog. With the order journal on
 * (`journal: "auto"`, enabled in BaseLinker), one request names the orders
 * that changed and only those are read; otherwise every followed order is
 * read (with `customSourceId`, 100 of our orders per request). Quiet when
 * nothing changed.
 */
export default async function baselinkerSyncStatusesJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  if (!canReadStatuses(svc.getOptions())) return
  await runStatusPass(container, "schedule")
}

export const config = {
  name: "baselinker-sync-statuses",
  schedule: STATUSES_SCHEDULE,
}
