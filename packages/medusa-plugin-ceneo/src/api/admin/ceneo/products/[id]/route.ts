import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { productCeneoCategory } from "../../../../../modules/ceneo/lib/categories"
import type { ProductCeneoResponse } from "../../../../../modules/ceneo/lib/contract"
import { OFFER_FIELDS, type OfferRow } from "../../../../../modules/ceneo/lib/offers"
import { ceneoSvc } from "../../../../../modules/ceneo/lib/store"
import { medusaCategories, queryOf, toCategoryDto, withTakeOver } from "../../helpers"

/**
 * GET /admin/ceneo/products/:id
 *
 * What Ceneo gets from one product, for the product widget: the offer of
 * each variant after the last build, with its problems, and the Ceneo
 * category the product maps to.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const productId = req.params.id
  const rows = (await svc.listCeneoOffers({ product_id: productId, retired_at: null }, { take: 100, order: { title: "ASC" }, select: OFFER_FIELDS })) as unknown as OfferRow[]
  const offers = await withTakeOver(svc, rows)

  const query = queryOf(req)
  const { data } = await query.graph({ entity: "product", fields: ["id", "categories.id"], filters: { id: productId } })
  const product = (data as Array<{ categories?: Array<{ id?: string | null } | null> | null }>)[0]
  const categoryIds = (product?.categories ?? []).map((c) => c?.id ?? "").filter(Boolean)
  let category: ProductCeneoResponse["category"] = null
  if (categoryIds.length > 0) {
    const maps = await svc.listCeneoCategoryMaps({}, { take: null, select: ["category_id", "ceneo_id"] })
    const own = new Map<string, string>()
    for (const m of maps) if (typeof m.category_id === "string" && typeof m.ceneo_id === "string") own.set(m.category_id, m.ceneo_id)
    if (own.size > 0) {
      const parents = new Map((await medusaCategories(query)).map((c) => [c.id, c.parentId]))
      const hit = productCeneoCategory(categoryIds, parents, own)
      if (hit) {
        const [row] = await svc.listCeneoCategories({ ceneo_id: hit.ceneoId }, { take: 1, select: ["ceneo_id", "name", "path", "leaf", "active"] })
        category = { ceneo: row ? toCategoryDto(row) : null, fromCategoryId: hit.categoryId }
      }
    }
  }
  const body: ProductCeneoResponse = { offers, category }
  res.json(body)
}
