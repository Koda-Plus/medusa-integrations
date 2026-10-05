import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isConnected } from "../../../../../modules/olx/lib/connection"
import { isStatsRunning } from "../../../../../workflows/olx/refresh-stats"
import { refreshOlxStatsWorkflow } from "../../../../../workflows/olx/workflows"
import { olxService } from "../../helpers"

/**
 * POST /admin/olx/stats/refresh
 *
 * Refreshes advert statistics now (202, in the background): the same capped
 * run as the hourly job, oldest numbers first.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  if (!svc.getOptions().statsEnabled) {
    res.status(409).json({ message: "Statistics are turned off in the plugin options (statsEnabled: false)." })
    return
  }
  if (!svc.isDemo() && !(await isConnected(svc))) {
    res.status(409).json({ message: "Connect the OLX account first." })
    return
  }
  if (isStatsRunning()) {
    res.status(202).json({ started: false, alreadyRunning: true })
    return
  }
  void refreshOlxStatsWorkflow(req.scope)
    .run({ input: { trigger: "manual" } })
    .catch((err: unknown) => svc.getLogger().error(`[olx] statistics: ${svc.mask(err instanceof Error ? err.message : String(err))}`))
  res.status(202).json({ started: true, alreadyRunning: false })
}
