import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isOfferState } from "../../../../modules/ceneo/lib/constants"
import type { OffersResponse } from "../../../../modules/ceneo/lib/contract"
import { OFFER_FIELDS, type OfferRow } from "../../../../modules/ceneo/lib/offers"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { intParam, likeOf, strParam, withTakeOver } from "../helpers"

/**
 * GET /admin/ceneo/offers?state=error&q=kubek&limit=50&offset=0
 *
 * The active offer rows (one per variant) after the last builds, by state
 * then name, with their problems (the admin opens on errors). `q` matches the name, the SKU or the offer id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const limit = intParam(req.query.limit, 50, 1, 200)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const state = typeof req.query.state === "string" && isOfferState(req.query.state) ? req.query.state : null
  const q = strParam(req.query.q)
  const filters: Record<string, unknown> = { retired_at: null }
  if (state) filters.state = state
  if (q) filters.$or = [{ title: { $ilike: likeOf(q) } }, { sku: { $ilike: likeOf(q) } }, { offer_id: { $ilike: likeOf(q) } }]
  const [rows, count] = await svc.listAndCountCeneoOffers(filters, { take: limit, skip: offset, order: { state: "ASC", title: "ASC" }, select: OFFER_FIELDS })
  const offers = await withTakeOver(svc, rows as unknown as OfferRow[])
  const body: OffersResponse = { offers, count, limit, offset }
  res.json(body)
}
