import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { basketRow, storeBasketDto } from "../../../../../workflows/inpostpay/baskets"
import { limited } from "../../../../inpostpay/store-helpers"

/**
 * GET /store/inpostpay/baskets/:id: the state of a bound basket, for the
 * storefront to poll while the customer confirms in the app: the status
 * (created, linked, rejected, ordered, failed, unbound), the masked phone,
 * the order id once it exists and InPost's payment status. The basket id is
 * a random id only that storefront session received.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (limited(req, res, "poll")) return
  const row = await basketRow(req.scope, String(req.params.id ?? ""))
  if (!row) {
    res.status(404).json({ code: "BASKET_NOT_FOUND", message: "Basket not found." })
    return
  }
  res.setHeader("Cache-Control", "no-store")
  res.json({ basket: storeBasketDto(row) })
}
