import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { kitBroadcasts } from "../../../../modules/kit/lib/insights"
import { clientOf, optionsOf } from "../../../kit/helpers"
import { isActive } from "../../../../modules/kit/lib/options"

/**
 * GET /admin/kit/broadcasts - the newest campaigns (drafts included) with
 * recipients, opens, clicks and unsubscribes. Read only, cached for ten
 * minutes (`?fresh=1` asks Kit again). `take` is 1 to 20, default 10.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!isActive(optionsOf(req.scope))) return res.json({ configured: false, broadcasts: [] })
  const take = Math.min(20, Math.max(1, Number(req.query.take) || 10))
  try {
    const broadcasts = await kitBroadcasts(clientOf(req.scope), take, req.query.fresh === "1")
    return res.json({ configured: true, broadcasts })
  } catch (e: any) {
    return res.status(502).json({ configured: true, broadcasts: [], error: e?.kind ?? "error", message: String(e?.message ?? e).slice(0, 300) })
  }
}
