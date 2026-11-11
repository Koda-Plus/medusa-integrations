/**
 * OFFER ROWS FOR THE ADMIN, AND TAKING OVER AN ID. Pure, zero runtime
 * imports.
 *
 * TAKING OVER. Ceneo forbids giving an id to another product, so an id is
 * refused when another variant holds it (`offer_id_taken`). One case is the
 * same product under a new variant: the store deleted the product and
 * created it again with the same SKU. Then a person may move the id, and
 * only then: the holder's variant has left the catalog (`variant_gone`).
 * The id moves with its row, so the history stays in one place, and the
 * next build writes the offer.
 */

import { PROBLEMS, isOfferState, type ProblemCode } from "./constants"
import type { OfferDto, OfferProblemDto } from "./contract"

export interface OfferRow {
  id: string
  offer_id?: string | null
  variant_id: string
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
  built_at?: string | Date | null
  retired_at?: string | Date | null
}

export const OFFER_FIELDS = ["id", "offer_id", "variant_id", "product_id", "sku", "title", "state", "problems", "in_feed", "price", "avail", "stock", "ceneo_category_id", "built_at", "retired_at"]

function isProblemCode(v: unknown): v is ProblemCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PROBLEMS, v)
}

export function problemsOf(raw: unknown): OfferProblemDto[] {
  if (!Array.isArray(raw)) return []
  const out: OfferProblemDto[] = []
  for (const p of raw) {
    if (!p || typeof p !== "object") continue
    const { code, detail } = p as { code?: unknown; detail?: unknown }
    if (!isProblemCode(code)) continue
    out.push(typeof detail === "string" ? { code, detail } : { code })
  }
  return out
}

function priceOf(raw: unknown): OfferDto["price"] {
  if (!raw || typeof raw !== "object") return null
  const { amount, currency_code } = raw as { amount?: unknown; currency_code?: unknown }
  const n = typeof amount === "number" ? amount : Number(amount)
  return Number.isFinite(n) && typeof currency_code === "string" ? { amount: n, currency_code } : null
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "string" && v) return new Date(v).toISOString()
  return new Date(0).toISOString()
}

/** The id this row was refused (`offer_id_taken`), or null. */
export function takenId(row: OfferRow): string | null {
  const p = problemsOf(row.problems).find((x) => x.code === "offer_id_taken")
  return p?.detail ?? null
}

export function isGone(row: OfferRow | undefined): boolean {
  return Boolean(row) && problemsOf(row?.problems).some((p) => p.code === "variant_gone")
}

export function toOfferDto(row: OfferRow, canTakeOver = false): OfferDto {
  return {
    id: row.id,
    offerId: row.offer_id ?? null,
    variantId: row.variant_id,
    productId: row.product_id ?? "",
    sku: row.sku ?? null,
    title: row.title ?? row.variant_id,
    state: isOfferState(row.state) ? row.state : "error",
    problems: problemsOf(row.problems),
    inFeed: row.in_feed === true,
    price: priceOf(row.price),
    avail: typeof row.avail === "number" ? row.avail : null,
    stock: typeof row.stock === "number" ? row.stock : null,
    ceneoCategoryId: row.ceneo_category_id ?? null,
    builtAt: iso(row.built_at),
    canTakeOver,
  }
}

export type TakeOverCheck = { ok: true } | { ok: false; code: "not_taken" | "holder_missing" | "holder_active" | "retired" }

/**
 * May `requester` (an active row refused with `offer_id_taken`) take the id
 * over from `holder`? `holderActive` is the active row of the holder's
 * variant (the holder itself, or its current row when the holder is retired).
 * `holderVariantExists` is what Medusa says now; it decides when given. A
 * variant only taken off the sales channel still exists and keeps its id.
 * Without it (the list) the last build's `variant_gone` is the hint.
 */
export function checkTakeOver(requester: OfferRow, holder: OfferRow | undefined, holderActive: OfferRow | undefined, holderVariantExists?: boolean): TakeOverCheck {
  if (requester.retired_at) return { ok: false, code: "retired" }
  const id = takenId(requester)
  if (!id) return { ok: false, code: "not_taken" }
  if (!holder || holder.offer_id !== id || holder.variant_id === requester.variant_id) return { ok: false, code: "holder_missing" }
  if (holderVariantExists !== undefined) return holderVariantExists ? { ok: false, code: "holder_active" } : { ok: true }
  if (holderActive ? !isGone(holderActive) : !holder.retired_at) return { ok: false, code: "holder_active" }
  return { ok: true }
}
