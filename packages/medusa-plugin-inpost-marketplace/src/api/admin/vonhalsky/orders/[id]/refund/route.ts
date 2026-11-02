import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refundOrder } from "../../../../../../workflows/vonhalsky/cases"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/orders/:id/refund { amount? }: the marketplace
 * refunds the buyer (the amount in PLN, or the whole order without one).
 * The Medusa order is not changed by this.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhord_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a marketplace order id of this plugin." })
    return
  }
  await respond(res, () => refundOrder(req.scope, id, (req.body as { amount?: unknown } | undefined)?.amount ?? null))
}
