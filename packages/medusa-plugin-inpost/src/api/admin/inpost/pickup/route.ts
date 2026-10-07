import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requestPickup } from "../../../../workflows/inpost/parcels"
import { actorOf, bodyOf, sendError } from "../helpers"

/**
 * POST /admin/inpost/pickup  { "ids": ["inpar_..."] }  (no ids: every ready one)
 *
 * Orders an InPost courier to pick up confirmed shipments sent with the
 * `dispatch_order` sending method: one dispatch order for all of them, from
 * the sender's address in Settings. Each shipment is claimed first, so it is
 * never in two pickups. Needs the shipment writer armed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const raw = bodyOf(req).ids
    const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && /^inpar_/.test(x)).slice(0, 100) : null
    const result = await requestPickup(req.scope, ids && ids.length > 0 ? ids : null, actorOf(req), "manual")
    res.json(result)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
