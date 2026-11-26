import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentationDetail } from "../../../../../../modules/avatars/lib/store"
import { saveScript } from "../../../../../../workflows/avatars/script"
import { bodyOf } from "../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/script  { script }
 *
 * Saves an edited script. A broken shape is refused (400 with `issues`);
 * broken writing rules come back as `issues` next to the saved script.
 * Saving after approval takes the approval back.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await saveScript(req.scope, String(req.params.id), bodyOf(req))
  if (!r.ok) {
    res.status(r.status).json({ type: r.status === 404 ? "not_found" : r.status === 409 ? "conflict" : "invalid_data", code: r.problems[0], problems: r.problems, issues: r.issues ?? [], message: r.problems.join(", ") })
    return
  }
  res.json({ presentation: toPresentationDetail(r.row, [], avatarsSvc(req.scope).getOptions().wordsPerMinute), issues: r.issues })
}
