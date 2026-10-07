import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { startConnecting } from "../../../../modules/allegro/lib/connection"
import { allegroService, buildStatus, sendError } from "../helpers"

/**
 * POST /admin/allegro/connect
 *
 * Starts a device login: asks Allegro for a code and returns the status with
 * `connecting` (the code, the allegro.pl address to type it at and the
 * expiry). The admin then polls POST /admin/allegro/connect/poll.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  if (svc.isDemo()) {
    res.status(409).json({ message: "Demo mode: connecting a real Allegro account is disabled." })
    return
  }
  if (!svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  try {
    await startConnecting(svc)
  } catch (err) {
    sendError(res, svc, err, "connect")
    return
  }
  res.json(await buildStatus(req.scope))
}
