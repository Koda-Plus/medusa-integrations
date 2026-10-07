import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resetDemo } from "../../../../../workflows/inpost/demo"
import { buildStatus, inpostService, sendError } from "../../helpers"

/**
 * POST /admin/inpost/demo/reset
 *
 * Demo mode only: starts the simulation over. The demo shipments, their
 * history and the demo settings and writer toggles go; the sample shipments
 * are built again from the newest orders. Live rows are never touched.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    if (!svc.isDemo()) {
      res.status(409).json({ code: "not_demo", message: "Only demo mode can be reset." })
      return
    }
    await resetDemo(req.scope)
    res.json(await buildStatus(req))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
