import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setPromotion } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/promotion { ids, promotion }: a promotion on
 * listed offers ({ mode: PERCENTAGE | FIXED_PRICE | AMOUNT, value, start,
 * end }, ISO dates), or null to end it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => setPromotion(req.scope, ids, (req.body as { promotion?: unknown } | undefined)?.promotion ?? null))
}
