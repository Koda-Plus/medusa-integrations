import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { OFFER_FIELDS, checkTakeOver, takenId, type OfferRow } from "../../../../../../modules/ceneo/lib/offers"
import { markCatalogChanged } from "../../../../../../modules/ceneo/lib/schedule"
import { ceneoSvc } from "../../../../../../modules/ceneo/lib/store"
import { FEED_LOCK } from "../../../../../../workflows/ceneo/build-feed"
import { withLock } from "../../../../../../workflows/ceneo/runtime"
import { queryOf } from "../../../helpers"

const REFUSALS: Record<string, string> = {
  not_taken: "This offer was not refused for an id another variant holds.",
  holder_missing: "No other variant holds this id any more; the next build gives it to this variant.",
  holder_active: "The variant that holds this id still exists in Medusa (maybe only off the sales channel). Ceneo forbids giving an id to another product.",
  retired: "This row is retired; use the active row of the variant.",
}

/**
 * POST /admin/ceneo/offers/:id/take-over
 *
 * Moves a refused id (`offer_id_taken`) to this variant, only when the
 * variant that held it has left the catalog: the same product created
 * again under a new variant. The holder's row moves with the id (its
 * history stays in one place); this variant's own row is retired, or
 * removed when it never had an id. The next build writes the offer.
 * Runs under the feed lock: never next to a build of this process.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const done = await withLock(FEED_LOCK, () => takeOver(req, res).then(() => true))
  if (done === null) res.status(409).json({ code: "feed_building", message: "The feed is being built; try again in a moment." })
}

async function variantExists(req: MedusaRequest, variantId: string): Promise<boolean> {
  const { data } = await queryOf(req).graph({ entity: "product_variant", fields: ["id"], filters: { id: variantId } })
  return data.length > 0
}

async function takeOver(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const [requester] = (await svc.listCeneoOffers({ id: req.params.id }, { take: 1, select: OFFER_FIELDS })) as unknown as OfferRow[]
  if (!requester) {
    res.status(404).json({ code: "not_found", message: "No such offer row." })
    return
  }
  const id = takenId(requester)
  const [holder] = id ? ((await svc.listCeneoOffers({ offer_id: id }, { take: 1, select: OFFER_FIELDS })) as unknown as OfferRow[]) : []
  const [holderActive] = holder ? ((await svc.listCeneoOffers({ variant_id: holder.variant_id, retired_at: null }, { take: 1, select: OFFER_FIELDS })) as unknown as OfferRow[]) : []
  const exists = holder ? await variantExists(req, holder.variant_id) : false
  const check = checkTakeOver(requester, holder, holderActive, exists)
  if (!check.ok || !holder) {
    const code = check.ok ? "holder_missing" : check.code
    res.status(409).json({ code, message: REFUSALS[code] ?? code })
    return
  }

  const now = new Date()
  /* No transaction across the three writes (3e): a failure between them leaves this variant without a row until the next build, which recreates it. */
  /* Free the one-active-row slot of this variant first, then move the holder's row onto it. */
  if (requester.offer_id) await svc.updateCeneoOffers([{ id: requester.id, retired_at: now, state: "excluded", in_feed: false, problems: [{ code: "offer_id_replaced" }], built_at: now }])
  else await svc.deleteCeneoOffers([requester.id])
  if (holderActive && holderActive.id !== holder.id) {
    /* The holder's old variant keeps a row without the id: it is gone, its row stays for the record. */
    await svc.updateCeneoOffers([{ id: holderActive.id, retired_at: now, built_at: now }])
  }
  await svc.updateCeneoOffers([
    {
      id: holder.id,
      variant_id: requester.variant_id,
      product_id: requester.product_id,
      sku: requester.sku ?? null,
      title: requester.title ?? holder.title,
      retired_at: null,
      state: "excluded",
      in_feed: false,
      problems: null,
      built_at: now,
    },
  ])
  svc.getLogger().info(`[ceneo] Offer id ${id} moved from variant ${holder.variant_id} to ${requester.variant_id}.`)
  markCatalogChanged()
  res.json({ offer_id: id, variant_id: requester.variant_id, row_id: holder.id })
}
