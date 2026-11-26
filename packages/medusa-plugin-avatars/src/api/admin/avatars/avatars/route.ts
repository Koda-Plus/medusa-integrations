import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toAvatar } from "../../../../modules/avatars/lib/store"
import { createAvatar } from "../../../../workflows/avatars/avatars"
import { bodyOf, problems } from "../helpers"

/** POST /admin/avatars/avatars  { name, face_id, voice? }  A new avatar, without consent until one is recorded. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await createAvatar(req.scope, bodyOf(req))
  if (!r.ok) return problems(res, r.status, r.problems)
  res.status(201).json({ avatar: toAvatar(r.row) })
}
