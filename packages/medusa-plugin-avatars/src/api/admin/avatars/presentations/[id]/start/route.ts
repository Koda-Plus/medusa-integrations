import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentation } from "../../../../../../modules/avatars/lib/store"
import { startScript } from "../../../../../../workflows/avatars/script"
import { actorOf, problems } from "../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/start
 *
 * Queues the transcription (a recording) or the script (a text). The work
 * runs in the scheduled job, not in this request: the answer is 202.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await startScript(req.scope, String(req.params.id), actorOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.status(202).json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}
