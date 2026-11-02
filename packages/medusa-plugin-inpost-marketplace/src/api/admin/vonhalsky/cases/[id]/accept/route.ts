import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { acceptReturn } from "../../../../../../workflows/vonhalsky/cases"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/cases/:id/accept { amount? }: accepts a return; the marketplace refunds the buyer (the amount, or what the return asks). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhcase_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a case id of this plugin." })
    return
  }
  await respond(res, () => acceptReturn(req.scope, id, (req.body as { amount?: unknown } | undefined)?.amount))
}
