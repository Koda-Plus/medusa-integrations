import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setOverride } from "../../../../../../workflows/vonhalsky/offers"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/:id/price { price_override }: a fixed gross price
 * for this offer ("129.99"), or null to go back to the channel markup.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhoff_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not an offer id." })
    return
  }
  const body = (req.body ?? {}) as { price_override?: unknown }
  if (!("price_override" in body)) {
    res.status(400).json({ code: "nothing_to_change", message: "Send price_override (a gross price, or null)." })
    return
  }
  await respond(res, async () => ({ offer: await setOverride(req.scope, id, body.price_override) }))
}
