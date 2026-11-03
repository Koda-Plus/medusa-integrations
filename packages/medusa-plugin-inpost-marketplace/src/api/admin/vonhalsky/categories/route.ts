import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CategoriesResponse } from "../../../../modules/vonhalsky/lib/contract"
import { readSyncState } from "../../../../modules/vonhalsky/lib/store"
import { searchCategories } from "../../../../workflows/vonhalsky/categories"
import { intParam, searchParam } from "../../../vonhalsky/admin-helpers"

/**
 * GET /admin/vonhalsky/categories?q=&leaf=1&offset=&limit=: the marketplace
 * category tree as the last sync saved it; `q` finds a part of the path.
 * Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const limit = intParam(req.query.limit, 50, 1, 200)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const { rows, count } = await searchCategories(req.scope, { search: searchParam(req.query.q), leafOnly: req.query.leaf === "1" || req.query.leaf === "true", limit, offset })
  const state = await readSyncState(req.scope)
  const body: CategoriesResponse = { categories: rows, count, synced_at: state.at.categories ?? null }
  res.json(body)
}
