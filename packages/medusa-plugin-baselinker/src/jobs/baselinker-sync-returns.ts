import type { MedusaContainer } from "@medusajs/framework/types"
import { RETURNS_SCHEDULE } from "../modules/baselinker/lib/constants"
import { canReadReturns } from "../modules/baselinker/lib/options"
import { syncReturns } from "../workflows/baselinker/returns"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * RETURNS FROM BASELINKER, EVERY HOUR AT MINUTE 45 (read only).
 *
 * A return window of 30 days is a page or two of `getOrderReturns`, plus the
 * status and reason lists: four requests an hour on most accounts. Quiet when
 * nothing changed.
 */
export default async function baselinkerSyncReturnsJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  if (!canReadReturns(svc.getOptions())) return
  await syncReturns(container, "schedule")
}

export const config = {
  name: "baselinker-sync-returns",
  schedule: RETURNS_SCHEDULE,
}
