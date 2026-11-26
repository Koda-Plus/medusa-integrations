import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { quoteRender } from "../../../../../../../workflows/avatars/render"
import { bodyOf } from "../../../../helpers"

/**
 * POST /admin/avatars/presentations/:id/render/quote  { shorts? }
 *
 * The speech of every clip that is not rendered yet, and what the render
 * costs: clips, their lengths and the avatar minutes. Nothing is ordered at
 * Tavus. `item` names the clip a refusal is about.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const r = await quoteRender(req.scope, String(req.params.id), bodyOf(req))
  if (!r.ok) {
    res.status(r.status).json({ type: r.status === 404 ? "not_found" : r.status === 409 ? "conflict" : "invalid_data", code: r.problems[0], problems: r.problems, item: r.item ?? null, message: r.problems.join(", ") })
    return
  }
  const q = r.quote
  res.json({ quote: { clips: q.clips.map((c) => ({ item_id: c.item_id, duration_ms: c.duration_ms, reused: c.reused })), minutes: q.minutes, quote_hash: q.quote_hash, limit: q.limit, over_limit: q.over_limit, risky: q.risky } })
}
