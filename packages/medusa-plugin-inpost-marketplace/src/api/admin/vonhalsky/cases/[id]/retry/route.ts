import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryRefund } from "../../../../../../workflows/vonhalsky/cases"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/cases/:id/retry: asks the marketplace to try a declined refund again. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhcase_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a case id of this plugin." })
    return
  }
  await respond(res, () => retryRefund(req.scope, id))
}
