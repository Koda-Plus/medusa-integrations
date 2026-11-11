import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CeneoCategorySearchResponse } from "../../../../modules/ceneo/lib/contract"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { intParam, likeOf, strParam, toCategoryDto } from "../helpers"

/**
 * GET /admin/ceneo/categories?q=dom kubki&limit=30
 *
 * Search in the Ceneo tree for the mapping picker: by parts of the path
 * (every word must match somewhere in it) or by the Ceneo id. Active
 * categories only, leaves first.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const q = strParam(req.query.q)
  const limit = intParam(req.query.limit, 30, 1, 100)
  if (!q) {
    const empty: CeneoCategorySearchResponse = { categories: [] }
    res.json(empty)
    return
  }
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6)
  const filters: Record<string, unknown> = /^\d+$/.test(q) ? { active: true, ceneo_id: q } : { active: true, $and: words.map((w) => ({ path: { $ilike: likeOf(w) } })) }
  const rows = await svc.listCeneoCategories(filters, { take: limit, order: { leaf: "DESC", depth: "DESC", path: "ASC" }, select: ["ceneo_id", "name", "path", "leaf", "active"] })
  const body: CeneoCategorySearchResponse = { categories: rows.map(toCategoryDto) }
  res.json(body)
}
