import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setAttributes } from "../../../../../../workflows/vonhalsky/offers"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/offers/:id/attributes { attributes }: the category parameters of one offer (sent with the next listing). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhoff_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not an offer id of this plugin." })
    return
  }
  await respond(res, () => setAttributes(req.scope, id, (req.body as { attributes?: unknown } | undefined)?.attributes))
}
