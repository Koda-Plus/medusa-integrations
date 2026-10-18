import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listOffers } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/list { ids }: "List selected". Offers
 * without a blocking reason go to the marketplace (demo: marked listed in
 * our table, nothing is sent; sandbox and live: 501 while the seller API is
 * pending). Blocked ones come back in `skipped` with their reason.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => listOffers(req.scope, ids))
}
