import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isConnected } from "../../../../../modules/olx/lib/connection"
import { isThreadsRunning } from "../../../../../workflows/olx/sync-threads"
import { syncOlxThreadsWorkflow } from "../../../../../workflows/olx/workflows"
import { olxService } from "../../helpers"

/**
 * POST /admin/olx/threads/sync
 *
 * Reads the message threads now (202, in the background). Read only.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  if (!svc.getOptions().messagesEnabled) {
    res.status(409).json({ message: "Messages are turned off in the plugin options (messagesEnabled: false)." })
    return
  }
  if (!svc.isDemo() && !(await isConnected(svc))) {
    res.status(409).json({ message: "Connect the OLX account first." })
    return
  }
  if (isThreadsRunning()) {
    res.status(202).json({ started: false, alreadyRunning: true })
    return
  }
  void syncOlxThreadsWorkflow(req.scope)
    .run({ input: { trigger: "manual" } })
    .catch((err: unknown) => svc.getLogger().error(`[olx] threads: ${svc.mask(err instanceof Error ? err.message : String(err))}`))
  res.status(202).json({ started: true, alreadyRunning: false })
}
