import type { MedusaContainer } from "@medusajs/framework/types"
import { SYNC_SCHEDULE } from "../modules/olx/lib/constants"
import { olxService } from "../api/admin/olx/helpers"
import { syncOlxAdvertsWorkflow } from "../workflows/olx/sync-olx-adverts"

/**
 * OLX ADVERTS, ONCE AN HOUR (at :30).
 *
 * An hour, not five minutes: listing and ending adverts is manual work done a
 * few times a day, so an hour of delay changes nothing, while five minutes
 * would mean twelve times more traffic to somebody else's API for nothing.
 * One run of a 2 000-advert account is about 40 requests.
 *
 * Quiet when there is nothing to do: not configured, not connected or
 * `syncEnabled: false` simply returns. The workflow records every run.
 */
export default async function olxSyncAdvertsJob(container: MedusaContainer): Promise<void> {
  const svc = olxService(container)
  const o = svc.getOptions()
  if (!o.syncEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await syncOlxAdvertsWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "olx-sync-adverts",
  schedule: SYNC_SCHEDULE,
}
