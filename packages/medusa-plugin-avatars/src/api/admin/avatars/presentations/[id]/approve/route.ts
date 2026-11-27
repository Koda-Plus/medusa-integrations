import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentation } from "../../../../../../modules/avatars/lib/store"
import { approveScript } from "../../../../../../workflows/avatars/script"
import { actorOf, bodyOf, problems } from "../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/approve  { script_hash }
 *
 * Approves the script the person saw: the hash must be the stored one
 * (409 stale otherwise, somebody saved in the meantime).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await approveScript(req.scope, String(req.params.id), bodyOf(req), actorOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}
