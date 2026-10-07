import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ReleaseResponse } from "../../../../../../modules/baselinker/lib/contract"
import { releaseQuarantine } from "../../../../../../workflows/baselinker/plans"
import { actorOf, baselinkerService, guarded } from "../../../helpers"

/**
 * POST /admin/baselinker/quarantine/:id/release
 *
 * A person fixed the cause (a card BaseLinker refused, a product Medusa
 * could not save): the item goes back to the plan and the next armed run
 * tries it again. A POST, not a DELETE: the quarantine row stays, with who
 * released it and when.
 */
export const POST = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const actor = await actorOf(req)
  const released = await releaseQuarantine(svc, req.params.id, actor.label ?? actor.id)
  if (!released) {
    res.status(404).json({ message: "Quarantine entry not found." })
    return
  }
  const body: ReleaseResponse = { released }
  res.json(body)
})
