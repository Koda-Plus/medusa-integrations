import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CeneoOrdersResponse } from "../../../../modules/ceneo/lib/contract"
import { toCeneoOrderDto } from "../../../../modules/ceneo/lib/order-dto"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { IMPORT_FIELDS } from "../../../../workflows/ceneo/import-orders"
import { orderStates, transportOf } from "../../../../workflows/ceneo/orders"
import { intParam, likeOf, strParam } from "../helpers"

/**
 * GET /admin/ceneo/orders?limit=&offset=&q=&unmatched=true&held=true
 *
 * Kup Teraz orders as last read from Ceneo, newest first. `q` matches the
 * Ceneo order number. The state name comes from the Ceneo dictionary when
 * it can be read.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const limit = intParam(req.query.limit, 25, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q)
  /* Demo rows and live rows never mix: the list shows the current mode. */
  const filters: Record<string, unknown> = { demo: svc.getOptions().demo }
  if (q) filters.displayed_order_id = { $ilike: likeOf(q) }
  if (req.query.unmatched === "true") filters.matched = false
  if (req.query.held === "true") filters.import_status = ["held", "failed"]
  const [rows, count] = await svc.listAndCountCeneoOrders(filters, { take: limit, skip: offset, order: { ordered_at: "DESC" }, select: IMPORT_FIELDS })
  const transport = await transportOf(svc).catch(() => null)
  const states = transport ? await orderStates(transport).catch(() => []) : []
  const names = new Map(states.map((s) => [s.id, s.description]))
  const body: CeneoOrdersResponse = { orders: rows.map((r) => toCeneoOrderDto(r, names, svc.getOptions().orders.importStates)), count, limit, offset }
  res.json(body)
}
