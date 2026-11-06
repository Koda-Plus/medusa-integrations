import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderInpostResponse } from "../../../../../modules/inpost/lib/contract"
import { toParcelDto } from "../../../../../modules/inpost/lib/dto"
import { lockerMapUrl } from "../../../../../modules/inpost/lib/lockers"
import { readFulfillmentData } from "../../../../../modules/inpost/lib/option-data"
import { returnsConfigured } from "../../../../../modules/inpost/lib/options"
import { toReturnDto } from "../../../../../modules/inpost/lib/returns"
import { listEvents, listParcels, listReturns, queryOf } from "../../../../../workflows/inpost/runtime"
import { eventDtos, inpostService, sendError, writersDto } from "../../helpers"

/**
 * GET /admin/inpost/orders/:orderId
 *
 * The order widget: the InPost option and locker the customer chose (from
 * the shipping method, before any fulfillment), the shipments and the InPost
 * returns of the order in the current mode with their history, and the
 * writers.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const orderId = req.params.orderId
    const { data } = await queryOf(req.scope).graph({
      entity: "order",
      fields: ["id", "shipping_methods.id", "shipping_methods.name", "shipping_methods.data", "shipping_methods.shipping_option_id"],
      filters: { id: orderId },
    })
    const order = data[0] as { shipping_methods?: Array<{ name?: string | null; data?: Record<string, unknown> | null }> | null } | undefined
    let chosen: OrderInpostResponse["chosen"] = null
    for (const m of order?.shipping_methods ?? []) {
      const read = readFulfillmentData(m.data ?? null)
      if (!read) continue
      chosen = {
        optionId: read.spec.id,
        kind: read.spec.kind,
        cod: read.spec.cod,
        locker: read.locker ? { code: read.locker.code, name: read.locker.name, address: read.locker.address, mapUrl: lockerMapUrl(read.locker) } : null,
        methodName: m.name ?? null,
      }
      break
    }
    const rows = await listParcels(svc, { order_id: orderId, demo: svc.isDemo() }, { take: 20, order: { created_at: "ASC" } })
    const returns = await listReturns(svc, { order_id: orderId, demo: svc.isDemo() }, { take: 20, order: { created_at: "ASC" } })
    const ids = [...rows.map((r) => r.id), ...returns.map((r) => r.id)]
    const events = ids.length > 0 ? await listEvents(svc, { parcel_id: ids }, { take: 80, order: { occurred_at: "DESC" } }) : []
    const body: OrderInpostResponse = {
      mode: svc.isDemo() ? "demo" : "live",
      configured: svc.isConfigured(),
      chosen,
      parcels: rows.map((r) => toParcelDto(r)),
      events: await eventDtos(req.scope, events),
      writers: await writersDto(req.scope),
      returns: returns.map((r) => toReturnDto(r)),
      returnsConfigured: returnsConfigured(svc.getOptions()),
    }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
