import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PlanDto, PlanResponse } from "../../../../../../modules/inpost/lib/contract"
import { toParcelDto } from "../../../../../../modules/inpost/lib/dto"
import { planForParcel } from "../../../../../../workflows/inpost/parcels"
import { isArmed } from "../../../../../../workflows/inpost/runtime"
import { inpostService, sendError } from "../../../helpers"

/**
 * GET /admin/inpost/parcels/:id/plan
 *
 * The plan a person reads before a shipment is created: the receiver (from
 * the order, now), the locker or the address, the parcel, the cash on
 * delivery and the insurance, the reference, the sending method, the courier
 * pickup, the problems and warnings, the exact ShipX request and its hash.
 * Nothing is sent and nothing about the receiver is stored.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const { row, plan } = await planForParcel(req.scope, req.params.id)
    const dto: PlanDto = {
      ok: plan.ok,
      kind: plan.kind,
      service: plan.service,
      receiver: plan.receiver,
      locker: plan.locker,
      parcel: plan.parcel,
      cod: plan.cod ? { amount: plan.cod.amount, currency: plan.cod.currency } : null,
      insurance: plan.insurance ? { amount: plan.insurance.amount, currency: plan.insurance.currency } : null,
      reference: plan.reference,
      sendingMethod: plan.sendingMethod,
      dropoffPoint: plan.dropoffPoint,
      sender: plan.sender as Record<string, unknown> | null,
      pickup: plan.pickup ? { name: plan.pickup.name, phone: plan.pickup.phone, email: plan.pickup.email, address: plan.pickup.address as unknown as Record<string, string> } : null,
      buysOffer: plan.buysOffer,
      problems: plan.problems,
      warnings: plan.warnings,
      request: plan.request as unknown as Record<string, unknown> | null,
      hash: plan.hash,
    }
    const body: PlanResponse = { parcel: toParcelDto(row), plan: dto, writerArmed: await isArmed(svc, "shipment"), mode: svc.isDemo() ? "demo" : "live" }
    res.setHeader("Cache-Control", "private, no-store")
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
