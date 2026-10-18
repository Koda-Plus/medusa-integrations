import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { reopenOffers } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/offers/reopen { ids }: closed offers back to draft (a person lists them again). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => reopenOffers(req.scope, ids))
}
