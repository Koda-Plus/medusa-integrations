import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ProductCardsResponse } from "../../../../../../modules/baselinker/lib/contract"
import { toCardDto, type ProductRow } from "../../../../../../modules/baselinker/lib/dto"
import { normalizeSku } from "../../../../../../modules/baselinker/lib/matching"
import { queryOf } from "../../../../../../workflows/baselinker/runtime"
import { baselinkerService } from "../../../helpers"

/**
 * GET /admin/baselinker/products/by-medusa/:productId
 *
 * For the product widget: the cards linked to the product's variants, plus
 * the cards that carry one of its SKUs but could not be linked (a duplicated
 * SKU in BaseLinker, for example), so the widget can say why.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const productId = req.params.productId
  const { data } = await queryOf(req.scope).graph({ entity: "product_variant", fields: ["id", "sku"], filters: { product_id: productId } })
  const keys = [...new Set((data as Array<{ sku?: string | null }>).map((v) => normalizeSku(v.sku)).filter((k): k is string => Boolean(k)))]
  const or: Array<Record<string, unknown>> = [{ product_id: productId }]
  if (keys.length > 0) or.push({ match_key: keys })
  const rows = (await svc.listBaseLinkerProducts({ demo: svc.isDemo(), $or: or } as never, {
    take: 50,
    order: { variant_sku: "ASC", bl_product_id: "ASC" },
  } as never)) as unknown as ProductRow[]
  const body: ProductCardsResponse = { mode: svc.isDemo() ? "demo" : "live", cards: rows.map(toCardDto) }
  res.json(body)
}
