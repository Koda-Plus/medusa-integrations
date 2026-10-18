import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { applyBasketEvent, basketRow, payloadForRow } from "../../../../../../../workflows/inpostpay/baskets"
import { bodyOf, fail, failWith, merchantGate, rowOrFail } from "../../../../../helpers"

/**
 * POST /inpostpay/v1/izi/basket/{basket_id}/event (called by InPost Pay,
 * signed): the customer changed the basket in the app. `event_type`
 * PRODUCTS_QUANTITY, PROMO_CODES or RELATED_PRODUCTS; the cart changes
 * through Medusa's cart workflows and the answer is the whole updated
 * basket, as the documentation asks.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  const row = await rowOrFail(req, res)
  if (!row) return
  if (row.order_id) return fail(res, 409, "BASKET_ORDERED", "This basket is already an order.")
  try {
    await applyBasketEvent(req.scope, row, bodyOf(req))
    res.json(await payloadForRow(req.scope, (await basketRow(req.scope, String(row.id))) ?? row))
  } catch (e) {
    failWith(req, res, e)
  }
}
