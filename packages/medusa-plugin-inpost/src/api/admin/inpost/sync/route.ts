import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runSync } from "../../../../workflows/inpost/sync"
import { inBackground, isRunning } from "../../../../workflows/inpost/runtime"
import { inpostService, sendError } from "../helpers"

/**
 * POST /admin/inpost/sync
 *
 * Starts the status pass now ("Refresh statuses"), in the background (202):
 * open shipments are read from ShipX, unknown creates looked up, the
 * automatic steps run when armed. One pass at a time per process.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    if (!svc.isConfigured()) {
      res.status(409).json({ code: "not_configured", message: `InPost is not configured: ${svc.missingOptions().join(", ")}.` })
      return
    }
    const alreadyRunning = isRunning("sync")
    if (!alreadyRunning) inBackground(req.scope, "status pass", () => runSync(req.scope, "manual"))
    res.status(202).json({ started: !alreadyRunning, alreadyRunning })
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
