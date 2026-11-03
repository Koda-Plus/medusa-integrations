import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STATS_WINDOWS } from "../../../../modules/vonhalsky/lib/stats"
import { readStats } from "../../../../workflows/vonhalsky/stats"

/**
 * GET /admin/vonhalsky/stats?days=7|30|90: the statistics tab (revenue
 * against the other sales channels, offers, products, fulfilment, mix,
 * discounts, after sale). Read only; the rows come from the sync.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const asked = Number(req.query.days)
  const days = (STATS_WINDOWS as readonly number[]).includes(asked) ? asked : 30
  res.setHeader("Cache-Control", "no-store, must-revalidate")
  res.json(await readStats(req.scope, days))
}
