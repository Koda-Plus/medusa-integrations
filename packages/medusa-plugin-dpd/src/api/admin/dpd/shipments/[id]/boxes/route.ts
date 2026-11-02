import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseBoxesInput, type PlanBox } from "../../../../../../modules/dpd/lib/boxes"
import type { PlanResponse } from "../../../../../../modules/dpd/lib/contract"
import { toPlanDto, toShipmentDto } from "../../../../../../modules/dpd/lib/dto"
import { setBoxes } from "../../../../../../workflows/dpd/plan"
import { isArmed, settingsOf } from "../../../../../../workflows/dpd/runtime"
import { ActionError, actorOf, bodyOf, dpdService, noStore, sendError, shipmentIdOf } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/boxes  { "boxes": [{ "weightKg": 2.5, "lengthCm": 40, "widthCm": 30, "heightCm": 20 }] | null }  ->  PlanResponse
 *
 * Sets the boxes of a shipment not created yet (pending, failed) by hand, 1
 * to 100 of them; `null` goes back to the boxes the plan computes. Answers
 * the fresh plan. 400 invalid names the fields that are wrong, in the
 * message and as `fields` ({ index: the 0-based box, field: weightKg,
 * lengthCm, widthCm or heightCm }). Nothing goes to DPD.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const svc = dpdService(req.scope)
    const id = shipmentIdOf(req)
    const body = bodyOf(req)
    if (!("boxes" in body)) throw new ActionError(400, "invalid", "Send { boxes: [...] } or { boxes: null }.")
    let boxes: PlanBox[] | null = null
    if (body.boxes !== null) {
      const parsed = parseBoxesInput(body.boxes)
      if (!parsed.ok) throw new ActionError(400, "invalid", `The boxes are not valid: ${parsed.errors.join(", ")}.`, parsed.fields)
      boxes = parsed.boxes
    }
    const { row, plan } = await setBoxes(req.scope, id, boxes, actorOf(req))
    const answer: PlanResponse = {
      shipment: toShipmentDto(row),
      plan: toPlanDto(plan),
      writerArmed: await isArmed(svc, "shipment"),
      mode: svc.mode(),
      labelPage: (await settingsOf(svc)).labelPage,
    }
    res.json(answer)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
