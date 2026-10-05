import type { MedusaContainer } from "@medusajs/framework/types"
import { STATS_SCHEDULE } from "../modules/olx/lib/constants"
import { olxService } from "../api/admin/olx/helpers"
import { refreshOlxStatsWorkflow } from "../workflows/olx/workflows"

/**
 * ADVERT STATISTICS, ONCE AN HOUR (at :45): views, phone views and observers
 * of the live adverts whose numbers are the oldest, `statsPerRun` adverts per
 * run (default 200), each at most every six hours. One request per advert,
 * on the same rate limiter as everything else.
 */
export default async function olxRefreshStatsJob(container: MedusaContainer): Promise<void> {
  const svc = olxService(container)
  const o = svc.getOptions()
  if (!o.statsEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await refreshOlxStatsWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "olx-refresh-stats",
  schedule: STATS_SCHEDULE,
}
