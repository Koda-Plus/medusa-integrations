import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { basketOfOrder, orderDetails } from "../../../../../../workflows/inpostpay/orders"
import { fail, failWith, merchantGate } from "../../../../helpers"

/** GET /inpostpay/v1/izi/order/{order_id} (called by InPost Pay, signed): the order InPost Pay placed, as the plugin knows it. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  try {
    const row = await basketOfOrder(req.scope, String((req.params as Record<string, string>).order_id ?? ""))
    if (!row) return fail(res, 404, "ORDER_NOT_FOUND", "No InPost Pay order with this id.")
    res.json(await orderDetails(req.scope, row))
  } catch (e) {
    failWith(req, res, e)
  }
}
