import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { medusaCategories } from "../../../../../workflows/vonhalsky/categories"

/**
 * GET /admin/vonhalsky/categories/map: Medusa's product categories with the
 * marketplace leaf each is mapped to. The mapping is saved through
 * POST /admin/vonhalsky/settings { categories }. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await medusaCategories(req.scope))
}
