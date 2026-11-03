import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setCategory } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/category { ids, categoryId }: a marketplace
 * leaf category chosen by a person for these offers (null goes back to the
 * mapping and the catalog hint).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  const categoryId = (req.body as { categoryId?: unknown } | undefined)?.categoryId
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  if (categoryId !== null && (typeof categoryId !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(categoryId))) {
    res.status(400).json({ code: "bad_category", message: "Not a marketplace category id." })
    return
  }
  await respond(res, () => setCategory(req.scope, ids, categoryId))
}
