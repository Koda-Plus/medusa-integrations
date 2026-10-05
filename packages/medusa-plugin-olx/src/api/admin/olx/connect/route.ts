import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { startConnecting } from "../../../../modules/olx/lib/connection"
import { buildStatus, olxService } from "../helpers"

/**
 * POST /admin/olx/connect
 *
 * Step one of connecting: a new `state` nonce (15 minutes) and the OLX
 * consent URL in `connecting.url`. The admin opens it; the seller, logged in
 * to OLX, approves; OLX sends the browser to /olx/callback.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  if (svc.isDemo()) {
    res.status(409).json({ message: "Demo mode: connecting a real OLX account is disabled." })
    return
  }
  if (!svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  try {
    await startConnecting(svc)
    res.json(await buildStatus(svc))
  } catch (err) {
    res.status(502).json({ message: svc.mask(err instanceof Error ? err.message : String(err)) })
  }
}
