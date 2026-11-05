import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createShipment } from "../../../../../../workflows/dpd/create"
import { actorOf, bodyOf, pageOf, respondShipment, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/create  { "planHash": "...", "page": "A4" | "LBL_PRINTER" }  ->  ActionResponse
 *
 * Creates the DPD shipment of a pending or failed row, exactly once, from the
 * plan the person read (the hash must match the plan of this moment: 409
 * plan_changed otherwise), and gets its label at once. Needs the shipment
 * writer allowed in the options and armed in Settings (409 writer_off,
 * not_armed, not_configured). A plan with problems answers 422. A refusal or
 * an unclear answer of DPD answers 200 with the row (failed, unknown). In
 * demo mode DPD is simulated.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, async () => {
    const id = shipmentIdOf(req)
    const body = bodyOf(req)
    const page = pageOf(body)
    const planHash = typeof body.planHash === "string" && body.planHash ? body.planHash : null
    return createShipment(req.scope, id, { planHash, page, actor: actorOf(req), trigger: "manual" })
  })
}
