/**
 * THE OFFER TABLE AFTER A BUILD. Pure: given the rows already there and the
 * drafts of this build, what to retire, update and create.
 *
 * TWO RULES FROM CENEO, ONE FROM US:
 *
 *   An id is never reused for another product. A row that ever held an id
 *   keeps it forever: it is never deleted, never renamed to another id.
 *   An id already held by another variant is refused (`offer_id_taken`).
 *
 *   One variant, one active row. Switching `offerId` from the variant id to
 *   the SKU (or a SKU change) retires the old row (`offer_id_replaced`,
 *   kept with its id) and opens a new one. Switching back revives the old
 *   row instead of failing on its own id.
 *
 *   A variant gone from the catalog keeps its row (`variant_gone`): if it
 *   comes back, it gets the same id.
 *
 * Rows are written only when something changed, so a quiet catalog writes
 * nothing between builds.
 */

import { isInFeed, offerState, type OfferDraft, type OfferPrice, type OfferProblem } from "./feed"

export interface OfferRowLite {
  id: string
  offer_id: string | null
  variant_id: string
  retired_at: string | Date | null
  product_id?: string | null
  sku?: string | null
  title?: string | null
  state?: string | null
  problems?: unknown
  in_feed?: boolean | null
  price?: unknown
  avail?: number | null
  stock?: number | null
  ceneo_category_id?: string | null
}

/** The columns a build writes for one offer. */
export interface OfferRowData {
  offer_id: string | null
  variant_id: string
  product_id: string
  sku: string | null
  title: string
  state: string
  problems: OfferProblem[] | null
  in_feed: boolean
  price: OfferPrice | null
  avail: number | null
  stock: number | null
  ceneo_category_id: string | null
}

export interface OfferSyncPlan {
  /** Active rows whose variant now has another id: retired, kept. */
  retire: string[]
  update: Array<{ id: string; data: OfferRowData; revive: boolean }>
  create: OfferRowData[]
  /** Active rows whose variant left the catalog. */
  gone: string[]
}

export const RETIRED_PROBLEMS: OfferProblem[] = [{ code: "offer_id_replaced" }]
export const GONE_PROBLEMS: OfferProblem[] = [{ code: "variant_gone" }]

export function rowData(d: OfferDraft, offerId: string | null): OfferRowData {
  return {
    offer_id: offerId,
    variant_id: d.variantId,
    product_id: d.productId,
    sku: d.sku,
    title: d.name || d.variantId,
    state: offerState(d.problems),
    problems: d.problems.length > 0 ? d.problems : null,
    in_feed: isInFeed(d),
    price: d.price,
    avail: d.avail,
    stock: d.stock,
    ceneo_category_id: d.ceneoCategoryId,
  }
}

function canon(v: unknown): string {
  return JSON.stringify(v ?? null)
}

/** The row already holds exactly this data. */
export function sameRow(row: OfferRowLite, data: OfferRowData): boolean {
  return (
    row.offer_id === data.offer_id &&
    (row.product_id ?? null) === data.product_id &&
    (row.sku ?? null) === data.sku &&
    (row.title ?? null) === data.title &&
    (row.state ?? null) === data.state &&
    canon(row.problems) === canon(data.problems) &&
    (row.in_feed ?? false) === data.in_feed &&
    canon(row.price) === canon(data.price) &&
    (row.avail ?? null) === data.avail &&
    (row.stock ?? null) === data.stock &&
    (row.ceneo_category_id ?? null) === data.ceneo_category_id
  )
}

function goneAlready(row: OfferRowLite): boolean {
  return row.state === "excluded" && row.in_feed === false && canon(row.problems) === canon(GONE_PROBLEMS)
}

/**
 * Checks the ids of the drafts against the table and plans the writes.
 * Drafts whose id another variant holds lose it here (`offer_id_taken`),
 * so call this BEFORE rendering the file.
 */
export function planOfferSync(drafts: OfferDraft[], rows: readonly OfferRowLite[]): OfferSyncPlan {
  const byOffer = new Map<string, OfferRowLite>()
  const active = new Map<string, OfferRowLite>()
  for (const r of rows) {
    if (r.offer_id) byOffer.set(r.offer_id, r)
    if (!r.retired_at) active.set(r.variant_id, r)
  }

  const plan: OfferSyncPlan = { retire: [], update: [], create: [], gone: [] }
  const seen = new Set<string>()
  const update = (row: OfferRowLite, data: OfferRowData, revive: boolean) => {
    if (revive || !sameRow(row, data)) plan.update.push({ id: row.id, data, revive })
  }

  for (const d of drafts) {
    seen.add(d.variantId)
    const current = active.get(d.variantId)

    let wanted = d.offerId
    if (wanted !== null) {
      const owner = byOffer.get(wanted)
      if (owner && owner.variant_id !== d.variantId) {
        d.problems.push({ code: "offer_id_taken", detail: wanted })
        d.offerId = null
        wanted = null
      }
    }

    if (wanted === null) {
      /* No id this time: the variant keeps the one it holds, if any. */
      if (current) update(current, rowData(d, current.offer_id), false)
      else plan.create.push(rowData(d, null))
      continue
    }

    const owner = byOffer.get(wanted)
    if (owner && current && owner.id === current.id) update(current, rowData(d, wanted), false)
    else if (owner) {
      /* A retired row of this same variant holds the id: revive it. */
      if (current) plan.retire.push(current.id)
      update(owner, rowData(d, wanted), true)
    } else if (current && current.offer_id === null) update(current, rowData(d, wanted), false)
    else {
      if (current) plan.retire.push(current.id)
      plan.create.push(rowData(d, wanted))
    }
  }

  for (const [variantId, row] of active) {
    if (!seen.has(variantId) && !goneAlready(row)) plan.gone.push(row.id)
  }
  return plan
}
