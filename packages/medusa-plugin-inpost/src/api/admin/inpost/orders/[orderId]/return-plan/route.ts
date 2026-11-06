import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ReturnPlanResponse } from "../../../../../../modules/inpost/lib/contract"
import { returnsConfigured } from "../../../../../../modules/inpost/lib/options"
import { toReturnDto } from "../../../../../../modules/inpost/lib/returns"
import { cleanReturnId, methodOf, planReturn } from "../../../../../../workflows/inpost/returns"
import { isArmed } from "../../../../../../workflows/inpost/runtime"
import { inpostService, sendError, strParam } from "../../../helpers"

/**
 * GET /admin/inpost/orders/:orderId/return-plan?returnId=&method=code|label
 *
 * The plan of an InPost return for the order, built now from the order and
 * never stored: the customer as InPost's sender (name, e-mail, phone in
 * E.164), the origin country, the order number for the label, a drop-off
 * code or a label, the expiry, and the exact Returns API request with its
 * hash. Create sends exactly this plan. Reads only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const { plan, existing } = await planReturn(req.scope, {
      orderId: req.params.orderId,
      returnId: cleanReturnId(strParam(req.query.returnId)),
      method: methodOf(strParam(req.query.method)),
    })
    const body: ReturnPlanResponse = {
      plan,
      existing: existing ? toReturnDto(existing) : null,
      writerArmed: await isArmed(svc, "returns"),
      configured: returnsConfigured(svc.getOptions()),
      mode: svc.isDemo() ? "demo" : "live",
    }
    res.setHeader("Cache-Control", "private, no-store")
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
