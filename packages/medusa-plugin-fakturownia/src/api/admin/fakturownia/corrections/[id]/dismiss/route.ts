import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PlanResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { dismissPlan } from "../../../../../../workflows/fakturownia/corrections"
import { ActionError, actorOf, fakturowniaService, planDtos } from "../../../helpers"

/**
 * POST /admin/fakturownia/corrections/:id/dismiss  { "note": "Corrected by hand in Fakturownia" }
 *
 * No correction from the plugin: a person handled it in Fakturownia, or
 * decided none is due. The change counts as decided, so it is not planned
 * again. An approved plan is dismissed only while its correction certainly
 * does not exist (queued or failed); its queued row is canceled.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const input = (req.body ?? {}) as { note?: unknown }
  try {
    const plan = await dismissPlan(req.scope, req.params.id, { note: typeof input.note === "string" ? input.note : null, actorId: actorOf(req) })
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
