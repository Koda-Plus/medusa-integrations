import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { previewSlide } from "../../../../../../workflows/avatars/script"
import { bodyOf, problems } from "../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/preview  { item, text? }
 *
 * One narration (a slide or a short version) as speech, audio/wav, with the
 * avatar's voice. `text` previews an edit before it is saved.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await previewSlide(req.scope, String(req.params.id), bodyOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.setHeader("Content-Type", "audio/wav")
  res.setHeader("Cache-Control", "private, no-store")
  res.status(200).send(r.audio)
}
