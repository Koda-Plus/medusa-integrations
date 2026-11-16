import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { parseConsent } from "../../../../modules/ceneo/lib/transaction"
import { cartExists, saveConsent } from "../../../../workflows/ceneo/consent"
import { bodyOf } from "../../../admin/ceneo/helpers"

/**
 * POST /store/ceneo/consent  { cart_id, survey }
 *
 * The shopper's answer to the Zaufane Opinie checkbox in the checkout
 * ("Send me the Ceneo survey about this purchase"). Stored per cart in the
 * plugin's table, never in cart metadata. Send it again when the shopper
 * changes their mind; the last answer before the order counts.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  if (!svc.getOptions().reviews.accountGuid) {
    res.status(404).json({ code: "reviews_off", message: "Zaufane Opinie are not configured (reviews.accountGuid)." })
    return
  }
  const parsed = parseConsent(bodyOf(req))
  if (!parsed.ok) {
    res.status(400).json({ code: "invalid_body", message: parsed.message })
    return
  }
  if (!(await cartExists(req.scope, parsed.cartId))) {
    res.status(404).json({ code: "cart_not_found", message: "No such cart." })
    return
  }
  await saveConsent(svc, parsed.cartId, { survey: parsed.survey, answered_at: new Date() })
  res.json({ cart_id: parsed.cartId, survey: parsed.survey })
}
