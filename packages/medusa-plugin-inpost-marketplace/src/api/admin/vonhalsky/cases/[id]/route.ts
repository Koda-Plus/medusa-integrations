import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { caseDetail } from "../../../../../workflows/vonhalsky/cases"
import { respond } from "../../../../vonhalsky/admin-helpers"

/** GET /admin/vonhalsky/cases/:id: one case read live from the marketplace, with the buyer contact (shown, never stored) and the reject reasons. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhcase_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a case id of this plugin." })
    return
  }
  res.setHeader("Cache-Control", "no-store")
  await respond(res, () => caseDetail(req.scope, id))
}
