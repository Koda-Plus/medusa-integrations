import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DemoResetResponse } from "../../../../../modules/dpd/lib/contract"
import { resetDemo } from "../../../../../workflows/dpd/demo"
import { dpdService, refuse, sendError } from "../../helpers"

/**
 * POST /admin/dpd/demo/reset  ->  DemoResetResponse
 *
 * Demo mode only (409 not_demo otherwise): removes the demo shipments, their
 * documents, history and handovers, and every `demo:` setting (the seed
 * marker and the demo writer toggles). Sandbox and live rows are never
 * touched. The page builds the sample rows again on its next visit.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = dpdService(req.scope)
    if (!svc.isDemo()) {
      refuse(res, 409, "not_demo", "Only demo mode can be reset.")
      return
    }
    const body: DemoResetResponse = { removed: await resetDemo(req.scope) }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
