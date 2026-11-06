import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setAttributesMany } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/attributes { ids, attributes }: the same
 * category parameters on many offers of ONE marketplace category. The
 * parameters given replace those on every offer (one with no values is
 * removed), the others stay. Offers on the marketplace get the change.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => setAttributesMany(req.scope, ids, (req.body as { attributes?: unknown } | undefined)?.attributes))
}
