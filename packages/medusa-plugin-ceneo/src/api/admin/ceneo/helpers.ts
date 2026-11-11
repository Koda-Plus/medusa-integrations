import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { CeneoCategoryDto, OfferDto } from "../../../modules/ceneo/lib/contract"
import { OFFER_FIELDS, checkTakeOver, takenId, toOfferDto, type OfferRow } from "../../../modules/ceneo/lib/offers"
import type { CeneoServiceLike, Row } from "../../../modules/ceneo/lib/store"
import type { QueryLike } from "../../../workflows/ceneo/runtime"

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = (req as MedusaRequest & { body?: unknown }).body
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export function queryOf(req: MedusaRequest): QueryLike {
  return req.scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
}

export function intParam(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? Number(v) : Number.NaN
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function strParam(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null
}

/** A LIKE pattern that matches `word` literally. */
export function likeOf(word: string): string {
  return `%${word.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
}

export function toCategoryDto(r: Row): CeneoCategoryDto {
  return { ceneoId: String(r.ceneo_id ?? ""), name: String(r.name ?? ""), path: String(r.path ?? ""), leaf: r.leaf !== false, active: r.active !== false }
}

export interface MedusaCategory {
  id: string
  name: string
  parentId: string | null
  hidden: boolean
}

/** Every Medusa category (the admin page lists them all; stores have hundreds, not millions). */
export async function medusaCategories(query: QueryLike): Promise<MedusaCategory[]> {
  const out: MedusaCategory[] = []
  for (let skip = 0; skip < 100_000; skip += 1000) {
    const { data } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "parent_category_id", "is_internal", "is_active"],
      pagination: { skip, take: 1000, order: { id: "ASC" } },
    })
    for (const c of data as Array<{ id: string; name?: string | null; parent_category_id?: string | null; is_internal?: boolean | null; is_active?: boolean | null }>) {
      out.push({ id: c.id, name: (c.name ?? "").trim() || c.id, parentId: c.parent_category_id ?? null, hidden: c.is_internal === true || c.is_active === false })
    }
    if (data.length < 1000) break
  }
  return out
}

/** The DTOs, each with whether its refused id may be taken over. */
export async function withTakeOver(svc: CeneoServiceLike, rows: OfferRow[]): Promise<OfferDto[]> {
  const taken = [...new Set(rows.map(takenId).filter((id): id is string => id !== null))]
  if (taken.length === 0) return rows.map((r) => toOfferDto(r))
  const holders = (await svc.listCeneoOffers({ offer_id: taken }, { take: null, select: OFFER_FIELDS })) as unknown as OfferRow[]
  const byOffer = new Map(holders.map((h) => [h.offer_id ?? "", h]))
  const variants = [...new Set(holders.map((h) => h.variant_id))]
  const active = (await svc.listCeneoOffers({ variant_id: variants, retired_at: null }, { take: null, select: OFFER_FIELDS })) as unknown as OfferRow[]
  const activeByVariant = new Map(active.map((a) => [a.variant_id, a]))
  return rows.map((r) => {
    const id = takenId(r)
    const holder = id ? byOffer.get(id) : undefined
    const ok = id ? checkTakeOver(r, holder, holder ? activeByVariant.get(holder.variant_id) : undefined).ok : false
    return toOfferDto(r, ok)
  })
}
