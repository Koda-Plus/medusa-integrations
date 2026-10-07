import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderByMedusaResponse } from "../../../../../../modules/baselinker/lib/contract"
import { toImportDto, toOrderDto } from "../../../../../../modules/baselinker/lib/dto"
import { canExportOrders } from "../../../../../../modules/baselinker/lib/options"
import { isSkipped } from "../../../../../../modules/baselinker/lib/order-payload"
import { trustedMarketplaceRef } from "../../../../../../workflows/baselinker/order-facts"
import { findImportRow } from "../../../../../../workflows/baselinker/order-import"
import { findOrderRow, loadOrderHead } from "../../../../../../workflows/baselinker/orders"
import { baselinkerService, guarded } from "../../../helpers"

/**
 * GET /admin/baselinker/orders/by-medusa/:orderId : the BaseLinker side of one
 * order, for the order page widget: the outbox row of an order sent to
 * BaseLinker, or the import row of a marketplace order that came from it,
 * and the shared marketplace reference when backend code wrote it. Reads
 * only: in demo mode too, the simulated statuses move in the demo job.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  const orderId = req.params.orderId
  const [row, imported, head] = await Promise.all([findOrderRow(svc, orderId), findImportRow(svc, { order_id: orderId }), loadOrderHead(req.scope, orderId)])
  const ref = head ? await trustedMarketplaceRef(req.scope, head) : null
  const skipCode =
    head?.status === "canceled"
      ? "canceled"
      : head && isSkipped(head.metadata, o.skipOrderMetadataKey)
        ? "skip_key"
        : ref && !o.exportMarketplaceOrders
          ? "marketplace_order"
          : null
  const body: OrderByMedusaResponse = {
    mode: o.demo ? "demo" : "live",
    exportOrders: o.exportOrders,
    canSend: canExportOrders(o) && !imported && !(ref && !o.exportMarketplaceOrders),
    skipKey: o.skipOrderMetadataKey,
    order: row ? toOrderDto(row) : null,
    imported: imported ? toImportDto(imported) : null,
    marketplaceRef: ref,
    skipCode,
  }
  res.json(body)
})
