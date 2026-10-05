import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_METADATA } from "../../../../../../modules/baselinker/lib/constants"
import type { ProductCardsResponse } from "../../../../../../modules/baselinker/lib/contract"
import { toCardDto, type ProductRow } from "../../../../../../modules/baselinker/lib/dto"
import { normalizeSku } from "../../../../../../modules/baselinker/lib/matching"
import { queryOf } from "../../../../../../workflows/baselinker/runtime"
import { baselinkerService } from "../../../helpers"

/**
 * GET /admin/baselinker/products/by-medusa/:productId
 *
 * For the product widget: the cards linked to the product's variants, the
 * cards that carry one of its SKUs but could not be linked (a duplicated SKU
 * in BaseLinker, for example), so the widget can say why, and the main card
 * the variant cards hang under (or the product was imported from), which is
 * a container and never linked itself.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const demo = svc.isDemo()
  const productId = req.params.productId
  const query = queryOf(req.scope)
  const [{ data: variants }, { data: products }] = await Promise.all([
    query.graph({ entity: "product_variant", fields: ["id", "sku"], filters: { product_id: productId } }),
    query.graph({ entity: "product", fields: ["id", "metadata"], filters: { id: productId } }),
  ])
  const keys = [...new Set((variants as Array<{ sku?: string | null }>).map((v) => normalizeSku(v.sku)).filter((k): k is string => Boolean(k)))]
  const or: Array<Record<string, unknown>> = [{ product_id: productId }]
  if (keys.length > 0) or.push({ match_key: keys })
  const rows = (await svc.listBaseLinkerProducts({ demo, $or: or } as never, {
    take: 50,
    order: { variant_sku: "ASC", bl_product_id: "ASC" },
  } as never)) as unknown as ProductRow[]

  const imported = (products as Array<{ metadata?: Record<string, unknown> | null }>)[0]?.metadata?.[PRODUCT_METADATA.productId]
  const parents = new Set(rows.map((r) => r.parent_id).filter((p): p is string => Boolean(p) && p !== "0"))
  if (typeof imported === "string" || typeof imported === "number") parents.add(String(imported))
  for (const r of rows) parents.delete(r.bl_product_id)
  const containers =
    parents.size > 0
      ? ((await svc.listBaseLinkerProducts({ demo, bl_product_id: [...parents] } as never, { take: 10 } as never)) as unknown as ProductRow[])
      : []

  const body: ProductCardsResponse = { mode: demo ? "demo" : "live", cards: [...containers, ...rows].map(toCardDto) }
  res.json(body)
}
