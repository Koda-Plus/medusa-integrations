import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoSeed } from "../../../../../workflows/inpost/demo"
import { buildStatus, inpostService, sendError } from "../../helpers"

/**
 * POST /admin/inpost/demo/seed
 *
 * Demo mode only: builds the sample shipments once, from the store's newest
 * orders (idempotent: a second call finds them and does nothing). The page
 * asks for it on its first visit; reads never seed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    if (!svc.isDemo()) {
      res.status(409).json({ code: "not_demo", message: "Only demo mode has sample shipments." })
      return
    }
    await ensureDemoSeed(req.scope)
    res.json(await buildStatus(req))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
