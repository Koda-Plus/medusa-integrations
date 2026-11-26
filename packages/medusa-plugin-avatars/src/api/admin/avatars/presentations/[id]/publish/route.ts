import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentation } from "../../../../../../modules/avatars/lib/store"
import { publishPresentation, unpublishPresentation } from "../../../../../../workflows/avatars/render"
import { problems } from "../../../helpers"

/** POST /admin/avatars/presentations/:id/publish  A ready presentation becomes visible to the store API. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await publishPresentation(req.scope, String(req.params.id))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}

/** DELETE /admin/avatars/presentations/:id/publish  Hidden from the store again, the clips stay. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await unpublishPresentation(req.scope, String(req.params.id))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}
