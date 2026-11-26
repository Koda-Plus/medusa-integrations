import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentationDetail } from "../../../../../modules/avatars/lib/store"
import { deletePresentation, readPresentation } from "../../../../../workflows/avatars/presentations"
import { problems } from "../../helpers"

/** GET /admin/avatars/presentations/:id  The presentation with its source, script and render jobs. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const found = await readPresentation(req.scope, String(req.params.id))
  if (!found) return problems(res, 404, ["not_found"])
  res.json({ presentation: toPresentationDetail(found.row, found.jobs, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}

/** DELETE /admin/avatars/presentations/:id  Refused (409) while a job runs. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await deletePresentation(req.scope, String(req.params.id))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ id: r.row.id, deleted: true })
}
