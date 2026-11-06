import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { detachOffers } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/detach { ids }: "Remove from the panel only".
 * The plugin forgets the marketplace offers of these rows without calling
 * InPost: they stay active on the marketplace as they are, the sync never
 * touches them again until they are listed or imported again. Closing on
 * the marketplace is `/offers/unlist`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => detachOffers(req.scope, ids))
}
