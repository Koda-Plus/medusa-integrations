import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canRender, consentOf } from "../../../../../modules/avatars/lib/consent"
import { toStorePresentation } from "../../../../../modules/avatars/lib/published"
import { avatarsSvc, str } from "../../../../../modules/avatars/lib/store"

/**
 * GET /store/avatars/presentations/:id
 *
 * One published presentation: slides with their clips, the quiz, the short
 * versions. 404 for anything not published (or whose avatar lost its
 * consent), so an id never tells whether a draft exists.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = avatarsSvc(req.scope)
  const row = (await svc.listAvatarsPresentations({ id: String(req.params.id), state: "published" }, { take: 1 }))[0]
  const avatarId = row ? str(row.avatar_id) : null
  const avatar = avatarId ? (await svc.listAvatarsAvatars({ id: avatarId }, { take: 1 }))[0] : undefined
  const visible = Boolean(row && avatar && canRender(consentOf(avatar)))
  const jobs = visible ? await svc.listAvatarsRenderJobs({ presentation_id: row!.id, state: "ready" }, { take: 500 }) : []
  const dto = visible ? toStorePresentation(row!, jobs) : null
  if (!dto) {
    res.status(404).json({ type: "not_found", code: "not_found", message: "not_found" })
    return
  }
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({ presentation: dto })
}
