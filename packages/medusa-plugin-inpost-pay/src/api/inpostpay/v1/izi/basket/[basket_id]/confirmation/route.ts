import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { confirmBinding, payloadForRow } from "../../../../../../../workflows/inpostpay/baskets"
import { bodyOf, failWith, merchantGate, rowOrFail } from "../../../../../helpers"

/**
 * POST /inpostpay/v1/izi/basket/{basket_id}/confirmation (called by InPost
 * Pay, signed): the customer linked the basket in the app (`status`
 * SUCCESS, or no status) or refused it (REJECT). The masked phone and
 * InPost's basket id are kept, never the full number. The answer is the
 * basket itself: without it InPost does not link the basket.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  const row = await rowOrFail(req, res)
  if (!row) return
  try {
    const updated = await confirmBinding(req.scope, row, bodyOf(req))
    res.json(await payloadForRow(req.scope, updated))
  } catch (e) {
    failWith(req, res, e)
  }
}
