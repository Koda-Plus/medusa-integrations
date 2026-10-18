import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refreshOffers } from "../../../../../workflows/vonhalsky/offers"
import { respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/refresh: reads the catalog again and writes
 * one offer row per variant (matching keys, GPSR, reasons, price, stock).
 * Lists nothing by itself.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(res, () => refreshOffers(req.scope))
}
