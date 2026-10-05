import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { olxUrls } from "../../../../../modules/olx/lib/constants"
import type { OlxProductAdvertsResponse } from "../../../../../modules/olx/lib/contract"
import { toAdvertDto, toAlertDto, toPublicationDto, type AdvertRow, type AlertRow, type PublicationRow } from "../../../../../modules/olx/lib/dto"
import { decorateAdverts, olxService } from "../../helpers"

/**
 * GET /admin/olx/products/:id
 *
 * Everything OLX knows about one product, for the product widget: its adverts
 * (primary first, with statistics and unread messages), its alerts and its
 * publish plan.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const demo = svc.isDemo()
  const productId = req.params.id
  const rows = (await svc.listOlxAdverts({ product_id: productId, demo } as never, {
    take: 50,
    order: { is_primary: "DESC", olx_created_at: "DESC" },
  })) as unknown as AdvertRow[]
  const adverts = await decorateAdverts(svc, rows.map(toAdvertDto), demo)
  const alerts = (await svc.listOlxAlerts({ product_id: productId, demo } as never, { take: 50 })) as unknown as AlertRow[]
  const publications = (await svc.listOlxPublications({ product_id: productId, demo } as never, { take: 20 })) as unknown as PublicationRow[]
  const body: OlxProductAdvertsResponse = {
    mode: demo ? "demo" : "live",
    adverts,
    alerts: alerts.map(toAlertDto),
    publications: publications.map(toPublicationDto),
    unread: adverts.reduce((sum, a) => sum + a.unread, 0),
    chatUrl: olxUrls(svc.getOptions().market).chat,
  }
  res.json(body)
}
