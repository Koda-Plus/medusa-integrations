import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isConnected } from "../../../../modules/olx/lib/connection"
import type { OlxSyncResponse } from "../../../../modules/olx/lib/contract"
import { isSyncRunning } from "../../../../workflows/olx/run-sync"
import { syncOlxAdvertsWorkflow } from "../../../../workflows/olx/sync-olx-adverts"
import { runOlxCycleWorkflow } from "../../../../workflows/olx/workflows"
import { olxService } from "../helpers"

/**
 * POST /admin/olx/sync
 *
 * Manual sync: the SAME workflow as the hourly job, then the plan and the
 * armed writers. Answers 202 right away and runs in the background; the admin
 * polls GET /admin/olx while `running`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const mode = svc.isDemo() ? "demo" : "live"

  if (isSyncRunning()) {
    const body: OlxSyncResponse = { started: false, alreadyRunning: true, mode }
    res.status(202).json(body)
    return
  }
  if (mode === "live") {
    if (!svc.isConfigured()) {
      res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
      return
    }
    if (!(await isConnected(svc))) {
      res.status(409).json({ message: "Connect the OLX account first." })
      return
    }
  }

  void syncOlxAdvertsWorkflow(req.scope)
    .run({ input: { trigger: "manual" } })
    .then(() => runOlxCycleWorkflow(req.scope).run({ input: { trigger: "manual" } }))
    .catch((err: unknown) => {
      svc.getLogger().error(`[olx] manual sync: ${svc.mask(err instanceof Error ? err.message : String(err))}`)
    })

  const body: OlxSyncResponse = { started: true, alreadyRunning: false, mode }
  res.status(202).json(body)
}
