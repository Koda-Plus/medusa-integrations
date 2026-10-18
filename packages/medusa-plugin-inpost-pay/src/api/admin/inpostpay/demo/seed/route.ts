import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { seedDemo } from "../../../../../workflows/inpostpay/demo"
import { InpostPayFlowError } from "../../../../../workflows/inpostpay/runtime"

/**
 * POST /admin/inpostpay/demo/seed: DEMO MODE ONLY. Sample baskets for the
 * panel, built once from the store's newest orders (each row marked
 * `demo`). Nothing of the orders changes; a second call adds nothing.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.json({ created: await seedDemo(req.scope) })
  } catch (e) {
    if (e instanceof InpostPayFlowError) {
      res.status(e.status).json({ code: e.code, message: e.message })
      return
    }
    throw e
  }
}
