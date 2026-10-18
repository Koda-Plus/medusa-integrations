import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { markUnbound } from "../../../../../../../workflows/inpostpay/baskets"
import { failWith, merchantGate, rowOrFail } from "../../../../../helpers"

/**
 * DELETE /inpostpay/v1/izi/basket/{basket_id}/binding (called by InPost Pay,
 * signed): the basket was unlinked from the phone in the app. The Medusa
 * cart stays as it is; the row says "unbound" (or stays "ordered").
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  const row = await rowOrFail(req, res)
  if (!row) return
  try {
    await markUnbound(req.scope, row, "Unlinked in the InPost app")
    res.status(200).json({})
  } catch (e) {
    failWith(req, res, e)
  }
}
