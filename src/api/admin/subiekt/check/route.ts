import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkConnection } from "../../../../workflows/subiekt/health"
import { buildStatus, subiektService } from "../helpers"

/**
 * POST /admin/subiekt/check
 *
 * "Check connection": one `GET /v1/health` now (the bridge logs in to
 * Sfera), then the fresh status. Waits for the answer, at most the plugin
 * timeout, because the person clicked and wants to see the result.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  if (!svc.isDemo() && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const result = await checkConnection(req.scope, "manual")
  res.json({ result, status: await buildStatus(svc) })
}
