import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { capturePrices } from "../../../../modules/compliance/lib/prices"

/**
 * POST /admin/compliance/prices/capture
 *
 * Snapshots the current base prices of the catalog now, so the Omnibus
 * "lowest price of the last 30 days" has a fresh point. The scheduled job
 * `compliance-price-snapshot` does the same every day.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const count = await capturePrices(req.scope)
  res.json({ captured: count })
}
