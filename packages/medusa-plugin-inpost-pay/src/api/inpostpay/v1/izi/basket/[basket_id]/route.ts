import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { payloadForRow } from "../../../../../../workflows/inpostpay/baskets"
import { failWith, merchantGate, rowOrFail } from "../../../../helpers"

/**
 * GET /inpostpay/v1/izi/basket/{basket_id} (Merchant Backend API, called by
 * InPost Pay, signed): the basket as the app shows it: summary, delivery,
 * products, promo codes. Built fresh from the Medusa cart on every call.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  const row = await rowOrFail(req, res)
  if (!row) return
  try {
    res.json(await payloadForRow(req.scope, row))
  } catch (e) {
    failWith(req, res, e)
  }
}
