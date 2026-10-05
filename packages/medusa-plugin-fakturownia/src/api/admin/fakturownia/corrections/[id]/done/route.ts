import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PlanResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { markPlanDone } from "../../../../../../workflows/fakturownia/corrections"
import { ActionError, actorOf, fakturowniaService, planDtos } from "../../../helpers"

/**
 * POST /admin/fakturownia/corrections/:id/done  { "note": "Entered in the register of returns" }
 *
 * A manual plan (a receipt's return for the register of returns, a claim or
 * an exchange, a document whose positions the plugin does not know) was
 * handled by a person outside the plugin.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const input = (req.body ?? {}) as { note?: unknown }
  try {
    const plan = await markPlanDone(req.scope, req.params.id, { note: typeof input.note === "string" ? input.note : null, actorId: actorOf(req) })
    const [dto] = await planDtos(req.scope, [plan])
    const body: PlanResponse = { plan: dto }
    res.json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ message: svc.mask(err.message) })
      return
    }
    throw err
  }
}
