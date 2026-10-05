import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { OLX_MODULE } from "../../../../../modules/olx/lib/constants"
import type { OlxStoreProductAdvertsResponse } from "../../../../../modules/olx/lib/contract"
import type { AdvertRow } from "../../../../../modules/olx/lib/dto"
import { LIVE_STATUSES } from "../../../../../modules/olx/lib/matching"
import type OlxModuleService from "../../../../../modules/olx/service"

/**
 * GET /store/olx/products/:id
 *
 * Live OLX adverts of a product, for an "Also on OLX" link on the product
 * page. Primary adverts only, real ones only (never demo samples), and only
 * public facts: URL, title, price and SKU.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = req.scope.resolve<OlxModuleService>(OLX_MODULE)
  const rows = (await svc.listOlxAdverts(
    { product_id: req.params.id, is_primary: true, demo: false, status: { $in: [...LIVE_STATUSES] } } as never,
    { take: 20, order: { olx_created_at: "DESC" } },
  )) as unknown as AdvertRow[]
  const body: OlxStoreProductAdvertsResponse = {
    adverts: rows.map((r) => ({ url: r.url, title: r.title, price: r.price ?? null, sku: r.sku })),
  }
  res.json(body)
}
