import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DemoSeedResponse } from "../../../../../modules/dpd/lib/contract"
import { ensureDemoSeed } from "../../../../../workflows/dpd/demo"
import { dpdService, refuse, sendError } from "../../helpers"

/**
 * POST /admin/dpd/demo/seed  ->  DemoSeedResponse
 *
 * Demo mode only (409 not_demo otherwise): builds the sample shipments once,
 * from the store's newest orders. Idempotent: the first call claims the
 * `demo:seeded` key, a second one finds it and builds nothing. The page asks
 * for it on its first visit; reads never seed. Nothing goes to DPD.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = dpdService(req.scope)
    if (!svc.isDemo()) {
      refuse(res, 409, "not_demo", "Only demo mode has sample shipments.")
      return
    }
    const created = await ensureDemoSeed(req.scope)
    const body: DemoSeedResponse = { seeded: created > 0, created, mode: svc.mode() }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
