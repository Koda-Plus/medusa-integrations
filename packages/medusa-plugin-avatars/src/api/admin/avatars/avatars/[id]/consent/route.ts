import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toAvatar } from "../../../../../../modules/avatars/lib/store"
import { recordConsent, revokeConsent } from "../../../../../../workflows/avatars/avatars"
import { actorOf, bodyOf, problems } from "../../../helpers"

/**
 * POST /admin/avatars/avatars/:id/consent  { file_url, signed_by, signed_at, note? }
 *
 * Records the written consent: the signed document (stored first through
 * POST /admin/uploads), who signed it and when. The admin who records it is
 * kept from the session.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await recordConsent(req.scope, String(req.params.id), bodyOf(req), actorOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ avatar: toAvatar(r.row) })
}

/** DELETE /admin/avatars/avatars/:id/consent  Revokes it; the record stays, renders stop. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await revokeConsent(req.scope, String(req.params.id), actorOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.json({ avatar: toAvatar(r.row) })
}
