import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { unlistOffers } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/offers/unlist { ids }: takes the chosen offers off the marketplace (demo: marked closed). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => unlistOffers(req.scope, ids))
}
