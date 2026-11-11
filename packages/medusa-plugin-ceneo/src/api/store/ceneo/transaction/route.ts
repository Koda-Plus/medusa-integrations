import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isCartId } from "../../../../modules/ceneo/lib/transaction"
import { transactionForCart } from "../../../../workflows/ceneo/consent"

/**
 * GET /store/ceneo/transaction?cart_id=cart_...
 *
 * For the order confirmation page: `{ account_guid, order_id, survey, transaction }`,
 * where `transaction` goes as is to `_ceneo('transaction', transaction)`.
 * Only for the order placed from this cart, only within 24 hours, the
 * e-mail only with the survey consent. 404 before the order exists, 410
 * after the window or for a canceled order.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store")
  const cartId = req.query.cart_id
  if (!isCartId(cartId)) {
    res.status(400).json({ code: "invalid_query", message: "cart_id must be a Medusa cart id (cart_...)." })
    return
  }
  const found = await transactionForCart(req.scope, cartId)
  if (!found.ok) {
    res.status(found.status).json({ code: found.code, message: found.message })
    return
  }
  res.json(found.body)
}
