import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CodeMailStatsResponse } from "../../../../../../modules/coupons/lib/contract"
import { codeMailStats } from "../../../../../../workflows/coupons/code-mail"
import { fail, idParam } from "../../../helpers"

/**
 * GET /admin/coupons/:id/code-mail/stats
 *
 * What the e-mails of the code gave, per send: people, delivered and opened
 * (when the store reports it), who ordered with the code afterwards, orders,
 * revenue and conversion; plus all orders with the code. Reads only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "No such coupon." })
    return
  }
  try {
    const body: CodeMailStatsResponse = await codeMailStats(req.scope, id)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The results of the code's e-mails could not be read.")
  }
}
