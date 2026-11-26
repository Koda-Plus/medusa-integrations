import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc, toPresentation } from "../../../../modules/avatars/lib/store"
import { createPresentation } from "../../../../workflows/avatars/presentations"
import { actorOf, bodyOf, problems } from "../helpers"

/**
 * POST /admin/avatars/presentations
 *   { title, lang?, source_kind: "text" | "recording", source_text? | source_file_url?, target_minutes?, avatar_id? }
 *
 * A new presentation in `draft`. Nothing paid runs here.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await createPresentation(req.scope, bodyOf(req), actorOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.status(201).json({ presentation: toPresentation(r.row, avatarsSvc(req.scope).getOptions().wordsPerMinute) })
}
