import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { applyInpostOrderEvent, basketOfOrder } from "../../../../../../../workflows/inpostpay/orders"
import { bodyOf, fail, failWith, merchantGate } from "../../../../../helpers"

/**
 * POST /inpostpay/v1/izi/order/{order_id}/event (called by InPost Pay,
 * signed): the payment or the order changed in the app (`event_data`:
 * payment_status, order_status, payment_type, payment_reference). Kept on
 * the basket row and shown on the order. The answer may carry the status
 * text the app shows the customer and the parcel numbers.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  try {
    const row = await basketOfOrder(req.scope, String((req.params as Record<string, string>).order_id ?? ""))
    if (!row) return fail(res, 404, "ORDER_NOT_FOUND", "No InPost Pay order with this id.")
    await applyInpostOrderEvent(req.scope, row, bodyOf(req))
    res.json({ order_merchant_status_description: "Zamówienie przyjęte przez sklep" })
  } catch (e) {
    failWith(req, res, e)
  }
}
