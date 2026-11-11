import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CeneoOrderDetailResponse } from "../../../../../modules/ceneo/lib/contract"
import { toCeneoOrderDto } from "../../../../../modules/ceneo/lib/order-dto"
import { ceneoSvc } from "../../../../../modules/ceneo/lib/store"
import { ORDER_FIELDS, orderStates, transportOf } from "../../../../../workflows/ceneo/orders"
import { errorText } from "../../../../../workflows/ceneo/runtime"

/**
 * GET /admin/ceneo/orders/:id
 *
 * One Kup Teraz order: the stored part, and the shipping, invoice, pickup
 * and extra services read from Ceneo now (personal data are never stored
 * by the plugin). When Ceneo cannot be read, the stored part comes back
 * with `detailError`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const [row] = await svc.listCeneoOrders({ id: req.params.id }, { take: 1, select: ORDER_FIELDS })
  if (!row) {
    res.status(404).json({ code: "not_found", message: "No such Kup Teraz order." })
    return
  }
  let detailError: string | null = null
  let names = new Map<number, string>()
  const empty = { shipping: [] as Record<string, unknown>[], invoice: [] as Record<string, unknown>[], pickup: [] as Record<string, unknown>[], services: [] as Record<string, unknown>[], remark: null as string | null }
  let detail = empty
  const transport = await transportOf(svc).catch(() => null)
  if (!transport) detailError = "No Ceneo API key: only the stored part is shown."
  else if ((row.demo === true) !== transport.demo) detailError = row.demo === true ? "A demo order: Ceneo has no data for it." : "A live order, and the plugin runs in demo mode: Ceneo is not asked."
  else {
    try {
      detail = await transport.detail(String(row.ceneo_order_id))
      names = new Map((await orderStates(transport).catch(() => [])).map((s) => [s.id, s.description]))
    } catch (err) {
      detailError = errorText(err)
    }
  }
  res.setHeader("Cache-Control", "no-store")
  const body: CeneoOrderDetailResponse = {
    order: toCeneoOrderDto(row, names),
    remark: detail.remark,
    shipping: detail.shipping[0] ?? null,
    invoice: detail.invoice[0] ?? null,
    pickup: detail.pickup[0] ?? null,
    services: detail.services,
    detailError,
  }
  res.json(body)
}
