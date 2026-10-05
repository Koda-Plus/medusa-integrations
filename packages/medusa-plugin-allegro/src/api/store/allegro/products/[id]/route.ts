import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ALLEGRO_MODULE, offerUrl } from "../../../../../modules/allegro/lib/constants"
import type { AllegroStoreProductOffersResponse } from "../../../../../modules/allegro/lib/contract"
import type { OfferRow } from "../../../../../modules/allegro/lib/dto"
import type AllegroModuleService from "../../../../../modules/allegro/service"

/**
 * GET /store/allegro/products/:id
 *
 * Live Allegro offers of a product, for an "Also on Allegro" link on the
 * product page. Primary offers only, real ones only (never demo samples), and
 * only public facts: URL, name, price and SKU.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = req.scope.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const rows = (await svc.listAllegroOffers(
    { product_id: req.params.id, is_primary: true, demo: false, status: "ACTIVE" } as never,
    { take: 20, order: { started_at: "DESC" } },
  )) as unknown as OfferRow[]
  const env = svc.getOptions().environment
  const body: AllegroStoreProductOffersResponse = {
    offers: rows.map((r) => ({ url: offerUrl(env, r.allegro_id), name: r.name, price: r.price ?? null, sku: r.sku })),
  }
  res.json(body)
}
