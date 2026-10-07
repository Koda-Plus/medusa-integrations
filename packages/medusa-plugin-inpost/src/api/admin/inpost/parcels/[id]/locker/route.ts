import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { changeLocker } from "../../../../../../workflows/inpost/parcels"
import { actorOf, bodyOf, respondParcel } from "../../../helpers"

/**
 * POST /admin/inpost/parcels/:id/locker  { "code": "KRA01M" }
 *
 * Fixes the locker of a shipment not sent yet (pending or failed). The code is
 * checked against the public points API (the demo lockers in demo mode) and
 * the locker's name and address are taken from there, never from the
 * request. Only this plugin's row changes; nothing goes to InPost.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const code = typeof bodyOf(req).code === "string" ? (bodyOf(req).code as string) : ""
  await respondParcel(req, res, () => changeLocker(req.scope, req.params.id, code, actorOf(req)))
}
