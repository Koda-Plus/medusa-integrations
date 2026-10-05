import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroOfferFilter, AllegroOffersResponse } from "../../../../modules/allegro/lib/contract"
import { toOfferDto, type OfferRow } from "../../../../modules/allegro/lib/dto"
import { STOCK_ISSUES } from "../../../../modules/allegro/lib/stock"
import { allegroService, intParam, like, strParam } from "../helpers"

const FILTERS: readonly AllegroOfferFilter[] = ["all", "linked", "unmatched", "stock", "ended_in_stock", "ended", "drafts", "nokey"]

/**
 * GET /admin/allegro/offers?filter=&q=&limit=&offset=
 *
 * The offer snapshot with its links and stock labels. `filter`: all, linked,
 * unmatched (live with a signature but no product), stock (oversell and sold
 * out), ended_in_stock, ended, drafts, nokey (no signature).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const rawFilter = strParam(req.query.filter) as AllegroOfferFilter
  const filter: AllegroOfferFilter = FILTERS.includes(rawFilter) ? rawFilter : "all"
  const q = strParam(req.query.q).slice(0, 80)

  const where: Record<string, unknown> = { demo: svc.isDemo() }
  switch (filter) {
    case "linked":
      where.variant_id = { $ne: null }
      break
    case "unmatched":
      where.variant_id = null
      where.match_key = { $ne: null }
      where.status = "ACTIVE"
      break
    case "stock":
      where.stock_state = { $in: [...STOCK_ISSUES] }
      break
    case "ended_in_stock":
      where.stock_state = "ended_in_stock"
      break
    case "ended":
      where.status = "ENDED"
      break
    case "drafts":
      where.status = "INACTIVE"
      break
    case "nokey":
      where.match_key = null
      break
  }
  if (q) {
    const pattern = like(q)
    where.$or = [
      { name: { $ilike: pattern } },
      { allegro_id: { $ilike: pattern } },
      { match_key: { $ilike: pattern } },
      { sku: { $ilike: pattern } },
    ]
  }

  const [rows, count] = (await svc.listAndCountAllegroOffers(where as never, {
    take: limit,
    skip: offset,
    order: { started_at: "DESC" },
  })) as unknown as [OfferRow[], number]

  const env = svc.getOptions().environment
  const body: AllegroOffersResponse = { offers: rows.map((r) => toOfferDto(r, env)), count, limit, offset }
  res.json(body)
}
