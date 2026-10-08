import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { priceWindows } from "../../../../../modules/compliance/lib/prices"

/**
 * GET /store/compliance/prices/:sku
 *
 * The Omnibus price window of one SKU: the current base price and the lowest
 * price of the last 30 days, per currency. Public, like the offer itself.
 * The storefront shows the lowest-30-days price when it announces a price
 * reduction, as the Omnibus Directive requires.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const sku = req.params.sku as string
  const windows = await priceWindows(req.scope)
  const hit = windows.filter((w) => w.sku === sku)
  if (hit.length === 0) {
    res.status(404).json({ type: "not_found", code: "not_found", message: "No price history for this SKU." })
    return
  }
  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({
    prices: hit.map((w) => ({
      currency_code: w.currency_code,
      amount: w.amount,
      lowest_30d: w.lowest_30d,
      lowest_before: w.lowest_before,
      snapshots: w.snapshots,
    })),
  })
}
