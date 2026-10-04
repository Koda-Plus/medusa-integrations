import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OlxProductAdvertsResponse } from "../../../../../modules/olx/lib/contract"
import { toAdvertDto, type AdvertRow } from "../../../../../modules/olx/lib/dto"
import { olxService } from "../../helpers"

/** GET /admin/olx/products/:id : adverts linked to the product's variants, primary first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const rows = (await svc.listOlxAdverts({ product_id: req.params.id, demo: svc.isDemo() } as never, {
    take: 50,
    order: { is_primary: "DESC", olx_created_at: "DESC" },
  })) as unknown as AdvertRow[]
  const body: OlxProductAdvertsResponse = { mode: svc.isDemo() ? "demo" : "live", adverts: rows.map(toAdvertDto) }
  res.json(body)
}
