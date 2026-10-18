import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { demoShip } from "../../../../../../workflows/vonhalsky/tracking"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/orders/:id/ship: DEMO MODE ONLY. Fulfils and ships
 * the simulated order in Medusa with a sample tracking number; the
 * subscribers then record the tracking as they would for a real shipment.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhord_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a marketplace order id of this plugin." })
    return
  }
  await respond(res, async () => ({ order: await demoShip(req.scope, id) }))
}
