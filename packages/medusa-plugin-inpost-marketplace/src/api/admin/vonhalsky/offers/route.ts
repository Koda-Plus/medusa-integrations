import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OfferFilter, OffersResponse } from "../../../../modules/vonhalsky/lib/contract"
import { offerFilter, readSettings, toOfferDto, vonHalskySvc } from "../../../../modules/vonhalsky/lib/store"
import { editableFactsOf, thumbnailsOf } from "../../../../workflows/vonhalsky/catalog"
import { categoryInfo } from "../../../../workflows/vonhalsky/categories"
import { optionsOf } from "../../../../workflows/vonhalsky/runtime"
import { intParam, searchParam } from "../../../vonhalsky/admin-helpers"

const FILTERS: OfferFilter[] = ["all", "listed", "draft", "blocked", "closed", "detached", "pending"]

/**
 * GET /admin/vonhalsky/offers?filter=&q=&offset=&limit=: the offers with
 * the product photo, status, reasons, price and stock, the marketplace
 * category path and what the marketplace says about each (`pending`: kept
 * PENDING or REJECTED). `q` finds a SKU, a
 * title, an EAN, a product id or a variant id. Each offer carries its edits
 * (`overrides`, `overridden`), Medusa's values of those fields (`medusa`, the
 * placeholders of "Edit offer") and what the marketplace gets (`effective`).
 * Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = vonHalskySvc(req.scope)
  const filter = FILTERS.includes(String(req.query.filter) as OfferFilter) ? (String(req.query.filter) as OfferFilter) : "all"
  const q = searchParam(req.query.q)
  const limit = intParam(req.query.limit, 50, 1, 200)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const filters: Record<string, unknown> = offerFilter(filter)
  if (q) {
    filters.$or = [{ sku: { $ilike: `%${q}%` } }, { title: { $ilike: `%${q}%` } }, { ean: q }, { product_id: q }, { variant_id: q }, { remote_id: q }]
  }
  const [rows, count] = await svc.listAndCountVonHalskyOffers(filters, { skip: offset, take: limit, order: { status: "ASC", title: "ASC" } })
  const list = rows as Array<Record<string, any>>
  const [thumbs, medusa, settings, cats] = await Promise.all([
    thumbnailsOf(req.scope, list.map((r) => String(r.variant_id))),
    editableFactsOf(req.scope, optionsOf(req.scope), list.map((r) => String(r.variant_id))),
    readSettings(req.scope),
    categoryInfo(req.scope, [...new Set(list.map((r) => r.category_id).filter(Boolean).map(String))]).catch(() => new Map()),
  ])
  const body: OffersResponse = {
    offers: list.map((r) =>
      toOfferDto(r, {
        thumbnail: thumbs.get(String(r.variant_id)) ?? null,
        categoryPath: r.category_id ? cats.get(String(r.category_id))?.path ?? null : null,
        medusa: medusa.get(String(r.variant_id)) ?? null,
        daysToShip: settings.offerDefaults.daysToShip,
      }),
    ),
    count: Number(count) || 0,
    offset,
    limit,
  }
  res.json(body)
}
