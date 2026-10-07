import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CardFilter, CardsResponse } from "../../../../modules/baselinker/lib/contract"
import { toCardDto, type ProductRow } from "../../../../modules/baselinker/lib/dto"
import { baselinkerService, guarded, intParam, like, strParam } from "../helpers"

const FILTERS: readonly CardFilter[] = ["all", "linked", "unmatched", "conflicts", "nosku"]

/** Main cards with variants are containers: never "only in BaseLinker", never "no SKU". SQL `!=` skips nulls, hence the `$or`. */
const SELLABLE = { $or: [{ match_source: null }, { match_source: { $ne: "parent" } }] }

/**
 * GET /admin/baselinker/products?filter=&q=&limit=&offset=
 *
 * The card snapshot with its links. `filter`: all, linked, unmatched (a card
 * without a variant and without a conflict: only in BaseLinker), conflicts,
 * nosku. `q` searches name, SKU, EAN, card id and the linked product (by
 * title, or exactly by a product or variant id).
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const raw = strParam(req.query.filter) as CardFilter
  const filter: CardFilter = FILTERS.includes(raw) ? raw : "all"
  const q = strParam(req.query.q).slice(0, 80)

  const and: Array<Record<string, unknown>> = [{ demo: svc.isDemo() }]
  switch (filter) {
    case "linked":
      and.push({ variant_id: { $ne: null } })
      break
    case "unmatched":
      and.push({ variant_id: null, conflict: null }, SELLABLE)
      break
    case "conflicts":
      and.push({ conflict: { $ne: null } })
      break
    case "nosku":
      and.push({ sku: null }, SELLABLE)
      break
  }
  if (q) {
    const pattern = like(q)
    and.push({
      $or: [
        { name: { $ilike: pattern } },
        { sku: { $ilike: pattern } },
        { ean: { $ilike: pattern } },
        { bl_product_id: { $ilike: pattern } },
        { variant_sku: { $ilike: pattern } },
        { product_title: { $ilike: pattern } },
        /* Deep links from a product or a variant (`?section=cards&q=prod_...`). */
        ...(/^(prod|variant)_[A-Za-z0-9]+$/.test(q) ? [{ product_id: q }, { variant_id: q }] : []),
      ],
    })
  }

  /* Conflicts sorted by key, so the cards of one duplicated SKU sit together. */
  const order = filter === "conflicts" ? { match_key: "ASC", bl_product_id: "ASC" } : { name: "ASC", bl_product_id: "ASC" }
  const [rows, count] = (await svc.listAndCountBaseLinkerProducts({ $and: and } as never, {
    take: limit,
    skip: offset,
    order,
  } as never)) as unknown as [ProductRow[], number]

  const body: CardsResponse = { cards: rows.map(toCardDto), count, limit, offset }
  res.json(body)
})
