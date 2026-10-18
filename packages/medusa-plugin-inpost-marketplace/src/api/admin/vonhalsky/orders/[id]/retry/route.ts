import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryOrder } from "../../../../../../workflows/vonhalsky/orders"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/orders/:id/retry: imports a held order again (read fresh from the marketplace). Never makes a second Medusa order. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhord_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a marketplace order id of this plugin." })
    return
  }
  await respond(res, () => retryOrder(req.scope, id))
}
