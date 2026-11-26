import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toAvatar } from "../../../../../modules/avatars/lib/store"
import { deleteAvatar, updateAvatar } from "../../../../../workflows/avatars/avatars"
import { bodyOf, problems } from "../../helpers"

/** POST /admin/avatars/avatars/:id  { name?, face_id?, voice? }  A new face resets a signed consent. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await updateAvatar(req.scope, String(req.params.id), bodyOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ avatar: toAvatar(r.row) })
}

/** DELETE /admin/avatars/avatars/:id  Refused (409) while a rendering or published presentation uses it. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await deleteAvatar(req.scope, String(req.params.id))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ id: r.row.id, deleted: true })
}
