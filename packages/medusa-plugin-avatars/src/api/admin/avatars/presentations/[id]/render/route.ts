import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentation } from "../../../../../../modules/avatars/lib/store"
import { startRender } from "../../../../../../workflows/avatars/render"
import { actorOf, bodyOf, problems } from "../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/render  { quote_hash, minutes }
 *
 * Confirms the last quote: the hash and the minutes the person saw. The
 * clips are ordered by the scheduled job, not in this request (202).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await startRender(req.scope, String(req.params.id), bodyOf(req), actorOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.status(202).json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}
