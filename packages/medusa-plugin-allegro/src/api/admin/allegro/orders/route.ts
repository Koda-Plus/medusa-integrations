import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroOrderFilter, AllegroOrdersResponse } from "../../../../modules/allegro/lib/contract"
import { toOrderDto, type OrderRow } from "../../../../modules/allegro/lib/dto"
import { allegroService, intParam, like, strParam } from "../helpers"

const FILTERS: readonly AllegroOrderFilter[] = ["all", "open", "sent", "cancelled", "unmatched"]
const SENT = ["SENT", "PICKED_UP", "READY_FOR_PICKUP"]
const CANCELLED = ["CANCELLED", "RETURNED"]

/**
 * GET /admin/allegro/orders?filter=&q=&limit=&offset=
 *
 * The read-only order journal, newest purchase first. `filter`: all, open,
 * sent, cancelled, unmatched (at least one line without a product). `q`
 * searches the order id and the delivery method; there is no buyer data to
 * search, by design.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const limit = intParam(req.query.limit, 10, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const rawFilter = strParam(req.query.filter) as AllegroOrderFilter
  const filter: AllegroOrderFilter = FILTERS.includes(rawFilter) ? rawFilter : "all"
  const q = strParam(req.query.q).slice(0, 80)

  const where: Record<string, unknown> = { demo: svc.isDemo() }
  switch (filter) {
    case "open":
      where.status = { $ne: "CANCELLED" }
      where.$or = [{ fulfillment_status: null }, { fulfillment_status: { $nin: [...SENT, ...CANCELLED] } }]
      break
    case "sent":
      where.fulfillment_status = { $in: SENT }
      break
    case "cancelled":
      where.$or = [{ status: "CANCELLED" }, { fulfillment_status: { $in: CANCELLED } }]
      break
    case "unmatched":
      where.unmatched_lines = { $gt: 0 }
      break
  }
  if (q) {
    const pattern = like(q)
    const search = [{ allegro_id: { $ilike: pattern } }, { delivery_method: { $ilike: pattern } }]
    if (where.$or) {
      where.$and = [{ $or: where.$or }, { $or: search }]
      delete where.$or
    } else {
      where.$or = search
    }
  }

  const [rows, count] = (await svc.listAndCountAllegroOrders(where as never, {
    take: limit,
    skip: offset,
    order: { bought_at: "DESC" },
  })) as unknown as [OrderRow[], number]

  const env = svc.getOptions().environment
  const body: AllegroOrdersResponse = { orders: rows.map((r) => toOrderDto(r, env)), count, limit, offset }
  res.json(body)
}
