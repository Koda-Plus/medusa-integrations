import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CheckResponse } from "../../../../modules/baselinker/lib/contract"
import { checkConnection } from "../../../../workflows/baselinker/check"
import { baselinkerService, buildStatus } from "../helpers"

/**
 * POST /admin/baselinker/check
 *
 * "Check connection": one `getInventories` call now (simulated in demo
 * mode). Waits for the answer, at most the plugin timeout, because a person
 * clicked and wants to see the result: the token, the catalog and whether
 * the warehouse belongs to it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  if (!svc.isDemo() && !svc.getOptions().apiToken) {
    res.status(409).json({ message: "Set apiToken in the plugin options first." })
    return
  }
  const result = await checkConnection(req.scope)
  if (!result) {
    res.status(409).json({ message: "A connection check is already running." })
    return
  }
  const body: CheckResponse = { result, status: await buildStatus(svc) }
  res.json(body)
}
