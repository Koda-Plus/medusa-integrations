import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { seedDemo } from "../../../../../workflows/allegro/demo-seed"
import { allegroService, errorOf } from "../../helpers"

/**
 * POST /admin/allegro/demo/seed
 *
 * Demo mode: prepares the sample data now instead of waiting for the job
 * `allegro-demo-seed` (once each kind that never ran). Starts in the
 * background (202); the page polls the status, whose `demoSeed.missing`
 * empties as the kinds finish. Outside demo mode: 409.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  if (!svc.isDemo()) {
    res.status(409).json({ code: "not_demo", message: "The demo data exists only in demo mode (demo: true)." })
    return
  }
  void seedDemo(req.scope).catch((err: unknown) => svc.getLogger().error(`[allegro] demo data: ${errorOf(svc, err)}`))
  res.status(202).json({ started: true })
}
