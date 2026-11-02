import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { hintOffer } from "../../../../../../workflows/vonhalsky/offers"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/:id/hint: asks the marketplace catalog what
 * it knows about the product (by EAN, then MPN) and keeps the category it
 * suggests when the offer has none. Nothing is listed by this.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhoff_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not an offer id of this plugin." })
    return
  }
  await respond(res, () => hintOffer(req.scope, id))
}
