import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderDpdResponse } from "../../../../../modules/dpd/lib/contract"
import { toShipmentDto } from "../../../../../modules/dpd/lib/dto"
import { pickDpdMethod } from "../../../../../modules/dpd/lib/option-data"
import { listEvents, listShipments, queryOf } from "../../../../../workflows/dpd/runtime"
import { dpdService, eventDtos, refuse, sendError, writersDto } from "../../helpers"

type OrderMethods = {
  id: string
  shipping_methods?: Array<{ name?: string | null; data?: Record<string, unknown> | null }> | null
}

/**
 * GET /admin/dpd/orders/:orderId  ->  OrderDpdResponse
 *
 * The order card: the DPD option, Pickup point and country the customer
 * chose (from the shipping method, before any fulfillment), the shipments of
 * the order in the current mode with their history, and the writers. With
 * several DPD methods (a claim, an exchange) the choice is the one the
 * recording uses without a fulfillment: the method the checkout validated,
 * else the first DPD method (pickDpdMethod). Reads
 * only; 404 not_found when there is no such order.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = dpdService(req.scope)
    const orderId = String(req.params.orderId ?? "")
    if (!/^[A-Za-z0-9_]{1,64}$/.test(orderId)) {
      refuse(res, 400, "invalid", "The order id is not valid.")
      return
    }
    const { data } = await queryOf(req.scope).graph({
      entity: "order",
      fields: ["id", "shipping_methods.id", "shipping_methods.name", "shipping_methods.data"],
      filters: { id: orderId },
    })
    const order = (data[0] as OrderMethods | undefined) ?? null
    if (!order) {
      refuse(res, 404, "not_found", "There is no such order.")
      return
    }
    const picked = pickDpdMethod(order.shipping_methods)
    const chosen: OrderDpdResponse["chosen"] = picked
      ? { optionId: picked.read.spec.id, optionKind: picked.read.spec.kind, cod: picked.read.spec.cod, pudoId: picked.read.pudoId, country: picked.read.country, methodName: picked.method.name ?? null }
      : null
    const rows = await listShipments(svc, { order_id: orderId, mode: svc.mode() }, { take: 50, order: { created_at: "ASC", id: "ASC" } })
    const events = rows.length > 0 ? await listEvents(svc, { shipment_id: rows.map((r) => r.id) }, { take: 60, order: { occurred_at: "DESC" } }) : []
    const body: OrderDpdResponse = {
      mode: svc.mode(),
      configured: svc.isConfigured(),
      chosen,
      shipments: rows.map((r) => toShipmentDto(r)),
      events: await eventDtos(req.scope, events),
      writers: await writersDto(req.scope),
    }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
