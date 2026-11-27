import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canRender, consentOf } from "../../../../modules/avatars/lib/consent"
import { toStoreListItem } from "../../../../modules/avatars/lib/published"
import { avatarsSvc } from "../../../../modules/avatars/lib/store"

/**
 * GET /store/avatars/presentations?lang=pl
 *
 * The published presentations, newest first. Needs the store's publishable
 * key like every /store route. Drafts, presentations in work and those whose
 * avatar lost its consent never show.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = avatarsSvc(req.scope)
  const lang = typeof req.query.lang === "string" ? req.query.lang : undefined
  const rows = await svc.listAvatarsPresentations({ state: "published", ...(lang ? { lang } : {}) }, { take: 200, order: { published_at: "DESC" } })
  const ids = [...new Set(rows.map((r) => r.avatar_id).filter((v): v is string => typeof v === "string" && v.length > 0))]
  const avatars = ids.length ? await svc.listAvatarsAvatars({ id: ids }, { take: ids.length }) : []
  const allowed = new Set(avatars.filter((a) => canRender(consentOf(a))).map((a) => a.id))
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({ presentations: rows.filter((r) => allowed.has(String(r.avatar_id))).map(toStoreListItem) })
}
