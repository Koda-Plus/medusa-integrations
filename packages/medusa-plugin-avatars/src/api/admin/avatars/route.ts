import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NEEDS_ACTION, RUNNING } from "../../../modules/avatars/lib/constants"
import type { StatusResponse } from "../../../modules/avatars/lib/contract"
import { avatarsSvc, toAvatar, toPresentation } from "../../../modules/avatars/lib/store"

/**
 * GET /admin/avatars
 *
 * The whole status of the AI Avatars page in one call: which services have
 * keys (never the keys), the options in use, the avatars with their consent
 * and the presentations, newest first.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = avatarsSvc(req.scope)
  const o = svc.getOptions()
  const [avatarRows, presentationRows] = await Promise.all([
    svc.listAvatarsAvatars({}, { take: 500, order: { created_at: "DESC" } }),
    svc.listAvatarsPresentations({}, { take: 500, order: { updated_at: "DESC" } }),
  ])
  const avatars = avatarRows.map(toAvatar)
  const presentations = presentationRows.map((r) => toPresentation(r, o.wordsPerMinute))

  const status: StatusResponse = {
    demo: o.demo,
    configured: svc.configured(),
    options: {
      claudeModel: o.claudeModel,
      ttsModel: o.ttsModel,
      transcribeModel: o.transcribeModel,
      defaultVoice: o.defaultVoice,
      defaultLang: o.defaultLang,
      wordsPerMinute: o.wordsPerMinute,
      maxRenderMinutes: o.maxRenderMinutes,
      filePrefix: o.filePrefix,
      scriptBrief: Boolean(o.scriptBrief),
      voiceStyle: Boolean(o.voiceStyle),
      maxSourceMb: o.maxSourceMb,
    },
    counts: {
      avatars: avatars.length,
      without_consent: avatars.filter((a) => !a.can_render).length,
      presentations: presentations.length,
      needs_action: presentations.filter((p) => NEEDS_ACTION.includes(p.state)).length,
      running: presentations.filter((p) => RUNNING.includes(p.state)).length,
      published: presentations.filter((p) => p.state === "published").length,
    },
    avatars,
    presentations,
  }
  res.json(status)
}
