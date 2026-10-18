import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { kitOverview } from "../../../../modules/kit/lib/insights"
import { clientOf, optionsOf } from "../../../kit/helpers"
import { isActive } from "../../../../modules/kit/lib/options"

/**
 * GET /admin/kit/overview - the list in numbers: active subscribers, growth
 * over 30 and 90 days, opens and clicks of the last 90 days. Read only,
 * cached for ten minutes (`?fresh=1` asks Kit again).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!isActive(optionsOf(req.scope))) return res.json({ configured: false, overview: null })
  try {
    const overview = await kitOverview(clientOf(req.scope), req.query.fresh === "1")
    return res.json({ configured: true, overview })
  } catch (e: any) {
    return res.status(502).json({ configured: true, overview: null, error: e?.kind ?? "error", message: String(e?.message ?? e).slice(0, 300) })
  }
}
