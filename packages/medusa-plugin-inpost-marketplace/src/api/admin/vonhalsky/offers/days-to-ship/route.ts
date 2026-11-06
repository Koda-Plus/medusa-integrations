import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { editOffers } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/days-to-ship { ids, daysToShip }: the days to
 * ship of many offers at once (0 to 60), or null to go back to the offer
 * defaults. Each offer goes the way of "Edit offer": offers on the
 * marketplace get the change (a published one is closed, patched and
 * reopened by the sync), one with a change still pending is skipped.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  const body = (req.body ?? {}) as { daysToShip?: unknown }
  if (!("daysToShip" in body)) {
    res.status(400).json({ code: "nothing_to_change", message: "Send daysToShip (0 to 60, or null for the offer defaults)." })
    return
  }
  await respond(res, () => editOffers(req.scope, ids, { daysToShip: body.daysToShip }))
}
