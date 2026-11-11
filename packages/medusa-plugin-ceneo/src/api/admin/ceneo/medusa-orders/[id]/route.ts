import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CeneoOrderLinkResponse } from "../../../../../modules/ceneo/lib/contract"
import { toCeneoOrderDto } from "../../../../../modules/ceneo/lib/order-dto"
import { ceneoSvc } from "../../../../../modules/ceneo/lib/store"
import { IMPORT_FIELDS } from "../../../../../workflows/ceneo/import-orders"

/**
 * GET /admin/ceneo/medusa-orders/:id
 *
 * The Kup Teraz order a Medusa order was imported from, for the widget on
 * the order page: `{ order: null }` for an order that did not come from
 * Ceneo. Stored data only, no call to Ceneo.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const [row] = await svc.listCeneoOrders({ medusa_order_id: String(req.params.id) }, { take: 1, select: IMPORT_FIELDS })
  const body: CeneoOrderLinkResponse = { order: row ? toCeneoOrderDto(row, new Map(), svc.getOptions().orders.importStates) : null }
  res.json(body)
}
