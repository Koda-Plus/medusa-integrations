import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createShipment } from "../../../../../../workflows/inpost/parcels"
import { actorOf, bodyOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/create  { "planHash": "..." }
 *
 * Creates the ShipX shipment of a pending row, exactly once, from the plan the
 * person read: the hash must match the plan of this moment (409 otherwise,
 * "read it again"). Needs the shipment writer allowed in the options and
 * armed in Settings (409 otherwise). A plan with problems answers 422. In demo
 * mode the shipment is simulated.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const planHash = typeof bodyOf(req).planHash === "string" ? (bodyOf(req).planHash as string) : null
  await respondParcel(req, res, () => createShipment(req.scope, req.params.id, { planHash, actor: actorOf(req), trigger: "manual" }))
}
