import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PlanResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { approvePlan } from "../../../../../../workflows/fakturownia/corrections"
import { ActionError, actorOf, fakturowniaService, planDtos } from "../../../helpers"

/**
 * POST /admin/fakturownia/corrections/:id/approve  { "revision": 2, "reason": "Zwrot towaru (zamówienie 1042)" }
 *
 * A person approves the plan AS THEY SAW IT: the revision they reviewed must
 * still be the plan's, otherwise 409 (it was recomputed after a new change).
 * The approval queues the correction document once, under the business key
 * of the order's source events. It is issued when the corrections writer is
 * armed (`armed` in the answer), right away or as soon as a person turns the
 * writer on. `reason` (optional, at most 256 characters) is printed on the
 * correction.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const input = (req.body ?? {}) as { revision?: unknown; reason?: unknown }
  try {
    const result = await approvePlan(req.scope, req.params.id, {
      revision: Number(input.revision),
      reason: typeof input.reason === "string" ? input.reason : null,
      actorId: actorOf(req),
    })
    const [plan] = await planDtos(req.scope, [result.plan])
    const body: PlanResponse = { plan, armed: result.armed }
    res.json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ message: svc.mask(err.message) })
      return
    }
    throw err
  }
}
