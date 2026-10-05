import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CheckResponse } from "../../../../modules/fakturownia/lib/contract"
import { checkConnection } from "../../../../workflows/fakturownia/check"
import { buildStatus, fakturowniaService } from "../helpers"

/**
 * POST /admin/fakturownia/check
 *
 * "Check connection": harmless reads now (the departments of the account, and
 * the categories when `categoryId` is set; simulated in demo mode). Waits for
 * the answer, at most the plugin timeout, because a person clicked.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  if (!svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const result = await checkConnection(req.scope)
  if (!result) {
    res.status(409).json({ message: "A connection check is already running." })
    return
  }
  const body: CheckResponse = { result, status: await buildStatus(req.scope) }
  res.json(body)
}
