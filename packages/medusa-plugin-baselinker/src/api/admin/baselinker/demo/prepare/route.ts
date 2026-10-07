import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DemoPrepareResponse } from "../../../../../modules/baselinker/lib/contract"
import { prepareDemo } from "../../../../../workflows/baselinker/demo"
import { baselinkerService, buildStatus, guarded } from "../../helpers"

/**
 * POST /admin/baselinker/demo/prepare
 *
 * Demo mode only: builds the simulated snapshot now ("Prepare now" on the
 * page) instead of waiting for the `baselinker-demo` job, and sends the
 * store's latest orders through the simulated account (plugin rows only,
 * never the orders themselves). Idempotent: a second call finds everything
 * done. 409 outside demo mode.
 */
export const POST = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  if (!svc.isDemo()) {
    res.status(409).json({ message: "Demo data exists only in demo mode (demo: true)." })
    return
  }
  const out = (await prepareDemo(req.scope)) ?? { prepared: false, built: false, sent: 0 }
  const body: DemoPrepareResponse = { ...out, status: await buildStatus(svc) }
  res.json(body)
})
