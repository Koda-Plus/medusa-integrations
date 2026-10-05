import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_METADATA } from "../../../../../../modules/baselinker/lib/constants"
import type { OrderByMedusaResponse } from "../../../../../../modules/baselinker/lib/contract"
import { toImportDto, toOrderDto } from "../../../../../../modules/baselinker/lib/dto"
import { canExportOrders } from "../../../../../../modules/baselinker/lib/options"
import { findImportRow } from "../../../../../../workflows/baselinker/order-import"
import { findOrderRow, loadOrderHead } from "../../../../../../workflows/baselinker/orders"
import { refreshDemoStatuses } from "../../../../../../workflows/baselinker/statuses"
import { baselinkerService } from "../../../helpers"

/**
 * GET /admin/baselinker/orders/by-medusa/:orderId : the BaseLinker side of one
 * order, for the order page widget: the outbox row of an order sent to
 * BaseLinker, or the import row of a marketplace order that came from it,
 * and the shared marketplace reference.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  await refreshDemoStatuses(req.scope)
  const orderId = req.params.orderId
  const [row, imported, head] = await Promise.all([findOrderRow(svc, orderId), findImportRow(svc, { order_id: orderId }), loadOrderHead(req.scope, orderId)])
  const ref = head?.metadata?.[ORDER_METADATA.marketplaceRef]
  const body: OrderByMedusaResponse = {
    mode: o.demo ? "demo" : "live",
    exportOrders: o.exportOrders,
    canSend: canExportOrders(o) && !imported && !(typeof ref === "string" && ref && !o.exportMarketplaceOrders),
    skipKey: o.skipOrderMetadataKey,
    order: row ? toOrderDto(row) : null,
    imported: imported ? toImportDto(imported) : null,
    marketplaceRef: typeof ref === "string" && ref ? ref : null,
  }
  res.json(body)
}
