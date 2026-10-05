import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OlxAdvertFilter, OlxAdvertsResponse } from "../../../../modules/olx/lib/contract"
import { toAdvertDto, type AdvertRow } from "../../../../modules/olx/lib/dto"
import { LIMITED_STATUS, LIVE_STATUSES } from "../../../../modules/olx/lib/matching"
import { decorateAdverts, intParam, like, olxService, strParam } from "../helpers"

const FILTERS: readonly OlxAdvertFilter[] = ["all", "linked", "unmatched", "limited", "ended", "nokey"]

/**
 * GET /admin/olx/adverts?filter=&q=&limit=&offset=
 *
 * The advert snapshot with its links, statistics, alert and unread messages.
 * `filter`: all, linked, unmatched (live with a key but no product), limited,
 * ended, nokey.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const demo = svc.isDemo()
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const rawFilter = strParam(req.query.filter) as OlxAdvertFilter
  const filter: OlxAdvertFilter = FILTERS.includes(rawFilter) ? rawFilter : "all"
  const q = strParam(req.query.q).slice(0, 80)

  const where: Record<string, unknown> = { demo }
  switch (filter) {
    case "linked":
      where.variant_id = { $ne: null }
      break
    case "unmatched":
      where.variant_id = null
      where.match_key = { $ne: null }
      where.status = { $in: [...LIVE_STATUSES] }
      break
    case "limited":
      where.status = LIMITED_STATUS
      break
    case "ended":
      where.status = { $nin: [...LIVE_STATUSES, LIMITED_STATUS] }
      break
    case "nokey":
      where.match_key = null
      break
  }
  if (q) {
    const pattern = like(q)
    where.$or = [
      { title: { $ilike: pattern } },
      { olx_id: { $ilike: pattern } },
      { match_key: { $ilike: pattern } },
      { sku: { $ilike: pattern } },
    ]
  }

  const [rows, count] = (await svc.listAndCountOlxAdverts(where as never, {
    take: limit,
    skip: offset,
    order: { olx_created_at: "DESC" },
  })) as unknown as [AdvertRow[], number]

  const body: OlxAdvertsResponse = { adverts: await decorateAdverts(svc, rows.map(toAdvertDto), demo), count, limit, offset }
  res.json(body)
}
