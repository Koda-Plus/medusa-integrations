import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroProductOffersResponse } from "../../../../../modules/allegro/lib/contract"
import { toOfferDto, type OfferRow } from "../../../../../modules/allegro/lib/dto"
import { allegroService } from "../../helpers"

/** GET /admin/allegro/products/:id : offers linked to the product's variants, primary first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const rows = (await svc.listAllegroOffers({ product_id: req.params.id, demo: svc.isDemo() } as never, {
    take: 50,
    order: { is_primary: "DESC", started_at: "DESC" },
  })) as unknown as OfferRow[]
  const env = svc.getOptions().environment
  const body: AllegroProductOffersResponse = {
    mode: svc.isDemo() ? "demo" : "live",
    offers: rows.map((r) => toOfferDto(r, env)),
  }
  res.json(body)
}
