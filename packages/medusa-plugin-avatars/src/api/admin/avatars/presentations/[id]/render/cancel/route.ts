import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentation } from "../../../../../../../modules/avatars/lib/store"
import { cancelRender } from "../../../../../../../workflows/avatars/render"
import { problems } from "../../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/render/cancel
 *
 * Stops a render: clips not ordered yet are not ordered, the presentation can
 * be quoted again. Clips already at Tavus may still finish there.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await cancelRender(req.scope, String(req.params.id))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}
