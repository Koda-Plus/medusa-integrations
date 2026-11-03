import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ResolveDispatchRequest } from "../../../../../../modules/dpd/lib/contract"
import { resolveDispatch } from "../../../../../../workflows/dpd/dispatch"
import { ActionError, actorOf, bodyOf, dispatchIdOf, respondDispatch } from "../../../helpers"

/**
 * POST /admin/dpd/dispatches/:id/resolve  { outcome: "ordered" | "not_ordered", orderNumber? }  ->  DispatchResponse
 *
 * A person says what DPD has: for an unknown dispatch, an ordered one with
 * an attention code, or an ordered one without a checkSum. Local, nothing
 * goes to DPD; writer pickup.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondDispatch(req, res, async () => {
    const id = dispatchIdOf(req)
    const body = bodyOf(req)
    const outcome = body.outcome
    if (outcome !== "ordered" && outcome !== "not_ordered") throw new ActionError(400, "invalid", "outcome is ordered or not_ordered.", [{ index: 0, field: "outcome" }])
    if (body.orderNumber !== undefined && body.orderNumber !== null && typeof body.orderNumber !== "string") {
      throw new ActionError(400, "invalid", "orderNumber is a text.", [{ index: 0, field: "orderNumber" }])
    }
    const request: ResolveDispatchRequest = typeof body.orderNumber === "string" ? { outcome, orderNumber: body.orderNumber } : { outcome }
    return resolveDispatch(req.scope, id, request, { actor: actorOf(req) })
  })
}
