import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderInpostPayResponse } from "../../../../../modules/inpostpay/lib/contract"
import { toBasketDto } from "../../../../../modules/inpostpay/lib/store"
import { basketOfOrder } from "../../../../../workflows/inpostpay/orders"
import { optionsOf } from "../../../../../workflows/inpostpay/runtime"

/** GET /admin/inpostpay/orders/:orderId: the InPost Pay basket of one order, for the order widget. Read only. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const o = optionsOf(req.scope)
  const row = await basketOfOrder(req.scope, String(req.params.orderId ?? ""))
  const body: OrderInpostPayResponse = { mode: o.mode, configured: o.mode !== "off", basket: row ? toBasketDto(row) : null }
  res.json(body)
}
