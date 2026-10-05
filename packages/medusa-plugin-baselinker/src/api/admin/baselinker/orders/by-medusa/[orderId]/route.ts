import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderByMedusaResponse } from "../../../../../../modules/baselinker/lib/contract"
import { toOrderDto } from "../../../../../../modules/baselinker/lib/dto"
import { canExportOrders } from "../../../../../../modules/baselinker/lib/options"
import { findOrderRow } from "../../../../../../workflows/baselinker/orders"
import { refreshDemoStatuses } from "../../../../../../workflows/baselinker/statuses"
import { baselinkerService } from "../../../helpers"

/** GET /admin/baselinker/orders/by-medusa/:orderId : the outbox row of one order, for the order page widget. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  await refreshDemoStatuses(req.scope)
  const row = await findOrderRow(svc, req.params.orderId)
  const body: OrderByMedusaResponse = {
    mode: o.demo ? "demo" : "live",
    exportOrders: o.exportOrders,
    canSend: canExportOrders(o),
    skipKey: o.skipOrderMetadataKey,
    order: row ? toOrderDto(row) : null,
  }
  res.json(body)
}
