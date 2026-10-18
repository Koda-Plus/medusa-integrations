import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { basketRow, storeBasketDto } from "../../../../../../workflows/inpostpay/baskets"
import { demoConfirm } from "../../../../../../workflows/inpostpay/demo"
import { optionsOf } from "../../../../../../workflows/inpostpay/runtime"
import { limited, storeFail } from "../../../../../inpostpay/store-helpers"

/**
 * POST /store/inpostpay/baskets/:id/demo-confirm { phone }: DEMO MODE ONLY.
 * Simulates the confirmation in the InPost app: a sample buyer (example.com
 * e-mail derived from a hash of the phone, a sample street, a sample parcel
 * locker), the shipping option, a payment session of this plugin's
 * provider, the cart completed. Answers the order id; a second call answers
 * the same order. 404 outside demo mode. At most 10 per client IP in 10
 * minutes.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!optionsOf(req.scope).demo) {
    res.status(404).json({ code: "NOT_DEMO", message: "The simulated confirmation exists only in demo mode." })
    return
  }
  if (limited(req, res, "confirm")) return
  const id = String(req.params.id ?? "")
  try {
    const result = await demoConfirm(req.scope, id, ((req.body ?? {}) as { phone?: unknown }).phone)
    const row = await basketRow(req.scope, id)
    res.json({ order_id: result.orderId, already: result.already, demo: true, basket: row ? storeBasketDto(row) : null })
  } catch (e) {
    storeFail(req, res, e)
  }
}
