import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { importOffers } from "../../../../../workflows/vonhalsky/offers"
import { respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/import: "Import from InPost". Reads every
 * offer already on the marketplace and links each one not linked yet to its
 * Medusa variant (external id, then SKU, EAN, manufacturer part number), so
 * the price and stock sync takes it over. Offers that match no variant come
 * back in `unmatched`; no product is ever created.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(res, () => importOffers(req.scope))
}
