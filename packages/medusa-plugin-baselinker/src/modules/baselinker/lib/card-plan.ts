/**
 * CARD PLAN: MEDUSA VARIANTS INTO BASELINKER CARDS. Pure; imports only other
 * pure files of this folder.
 *
 * For stores whose catalog lives in Medusa (`catalogSource: "medusa"`). A
 * variant without a card gets one (`addInventoryProduct` without an id), a
 * linked card whose name or EAN no longer matches Medusa gets an update
 * (`addInventoryProduct` with its id). Each variant becomes its own card;
 * grouping variants under a main card stays a decision made in BaseLinker.
 *
 * NEVER A SECOND CARD FOR THE SAME GOODS. A variant whose SKU already sits on
 * any card (linked to another variant, in conflict, or a main card) is a
 * conflict, and so is a variant whose EAN is on a card with another SKU.
 * And an incomplete read plans nothing: a card missing from a broken list
 * would be created again.
 *
 * What is sent on create: name, SKU, EAN, weight (kilograms), description
 * and up to 16 images, the price when Medusa prices include tax, and the
 * stock when Medusa is the source of stock. Updates touch name and EAN only:
 * stock and prices have writers of their own.
 */

import type { PlanChange } from "./contract"
import { normalizeEan, normalizeSku } from "./matching"

export interface CardPlanVariant {
  id: string
  productId: string
  sku: string | null
  ean: string | null
  /** Product title, plus the variant title when it is not the default one. */
  name: string
  description: string | null
  images: string[]
  /** Kilograms. */
  weightKg: number | null
  /** Gross price for the configured price group, or null when it cannot be known. */
  price: number | null
  /** Medusa available quantity, for the first stock of a new card (stock source Medusa only). */
  available: number | null
}

export interface CardPlanCard {
  blProductId: string
  sku: string | null
  ean: string | null
  name: string
  /** The variant this card is linked to, or null. */
  variantId: string | null
  conflict: string | null
}

export interface CardPlanInput {
  complete: boolean
  variants: readonly CardPlanVariant[]
  cards: readonly CardPlanCard[]
}

export type CardReason = "no_sku" | "sku_too_long" | "sku_on_card" | "ean_on_other_card" | "duplicate_variant_sku"

/**
 * BaseLinker SKUs hold 50 characters (`addInventoryProduct`: varchar(50)). A
 * longer Medusa SKU would arrive cut, could never be matched back to its
 * variant, and the next plan would propose the card again: such a variant
 * is skipped with the reason instead.
 */
export const CARD_SKU_MAX = 50

export interface CardCreate {
  sku: string
  ean: string | null
  name: string
  description: string | null
  images: string[]
  weightKg: number | null
  price: number | null
  available: number | null
}

export interface CardItem {
  /** `variant:<id>`. */
  key: string
  action: "create" | "update" | "skip" | "conflict"
  reason: CardReason | null
  label: string
  sku: string | null
  variantId: string
  productId: string
  blProductId: string | null
  changes: PlanChange[]
  create?: CardCreate
  update?: { blProductId: string; name?: string; ean?: string }
}

export interface CardPlan {
  skipped: null | "incomplete_read"
  /** Creates and updates first, then the skips and conflicts. */
  items: CardItem[]
  stats: { variants: number; create: number; update: number; unchanged: number; skip: number; conflict: number }
}

/** BaseLinker card names hold 200 characters. */
export const CARD_NAME_MAX = 200

export function cardName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, CARD_NAME_MAX)
}

export function planCards(input: CardPlanInput): CardPlan {
  const stats = { variants: 0, create: 0, update: 0, unchanged: 0, skip: 0, conflict: 0 }
  if (!input.complete) return { skipped: "incomplete_read", items: [], stats }

  const bySku = new Map<string, CardPlanCard[]>()
  const byEan = new Map<string, CardPlanCard[]>()
  const linked = new Map<string, CardPlanCard>()
  for (const c of input.cards) {
    const sku = normalizeSku(c.sku)
    const ean = normalizeEan(c.ean)
    if (sku) bySku.set(sku, [...(bySku.get(sku) ?? []), c])
    if (ean) byEan.set(ean, [...(byEan.get(ean) ?? []), c])
    if (c.variantId && !c.conflict) linked.set(c.variantId, c)
  }
  const skuUse = new Map<string, number>()
  for (const v of input.variants) {
    const sku = normalizeSku(v.sku)
    if (sku) skuUse.set(sku, (skuUse.get(sku) ?? 0) + 1)
  }

  const applicable: CardItem[] = []
  const info: CardItem[] = []
  for (const v of input.variants) {
    stats.variants += 1
    const sku = normalizeSku(v.sku)
    const ean = normalizeEan(v.ean)
    const name = cardName(v.name)
    const base = { key: `variant:${v.id}`, label: name || v.sku || v.id, sku: v.sku, variantId: v.id, productId: v.productId, changes: [] as PlanChange[] }
    const card = linked.get(v.id)
    if (card) {
      const changes: PlanChange[] = []
      const update: CardItem["update"] = { blProductId: card.blProductId }
      if (name && name !== cardName(card.name)) {
        changes.push({ field: "name", from: card.name, to: name })
        update.name = name
      }
      if (ean && ean !== normalizeEan(card.ean)) {
        changes.push({ field: "ean", from: card.ean, to: ean })
        update.ean = ean
      }
      if (changes.length === 0) {
        stats.unchanged += 1
        continue
      }
      stats.update += 1
      applicable.push({ ...base, action: "update", reason: null, blProductId: card.blProductId, changes, update })
      continue
    }
    if (!sku) {
      stats.skip += 1
      info.push({ ...base, action: "skip", reason: "no_sku", blProductId: null })
      continue
    }
    if ((v.sku as string).trim().length > CARD_SKU_MAX) {
      stats.skip += 1
      info.push({ ...base, action: "skip", reason: "sku_too_long", blProductId: null })
      continue
    }
    if ((skuUse.get(sku) ?? 0) > 1) {
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "duplicate_variant_sku", blProductId: null })
      continue
    }
    const sameSku = bySku.get(sku) ?? []
    if (sameSku.length > 0) {
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "sku_on_card", blProductId: sameSku[0].blProductId, changes: sameSku.map((c) => ({ field: "card", from: c.blProductId, to: null })) })
      continue
    }
    const sameEan = ean ? byEan.get(ean) ?? [] : []
    if (sameEan.length > 0) {
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "ean_on_other_card", blProductId: sameEan[0].blProductId, changes: [{ field: "ean", from: ean, to: null }] })
      continue
    }
    const changes: PlanChange[] = [
      { field: "name", from: null, to: name },
      { field: "sku", from: null, to: (v.sku as string).trim() },
    ]
    if (ean) changes.push({ field: "ean", from: null, to: ean })
    if (v.price !== null) changes.push({ field: "price", from: null, to: v.price })
    if (v.available !== null) changes.push({ field: "stock", from: null, to: Math.max(0, Math.trunc(v.available)) })
    if (v.images.length > 0) changes.push({ field: "images", from: null, to: Math.min(16, v.images.length) })
    stats.create += 1
    applicable.push({
      ...base,
      action: "create",
      reason: null,
      blProductId: null,
      changes,
      create: {
        sku: (v.sku as string).trim(),
        ean,
        name,
        description: v.description,
        images: v.images.filter((u) => /^https?:\/\//i.test(u)).slice(0, 16),
        weightKg: v.weightKg,
        price: v.price,
        available: v.available === null ? null : Math.max(0, Math.trunc(v.available)),
      },
    })
  }
  /* Updates first (the card exists and sells now), then creates. */
  applicable.sort((a, b) => (a.action === b.action ? 0 : a.action === "update" ? -1 : 1))
  return { skipped: null, items: [...applicable, ...info], stats }
}

/** `addInventoryProduct` parameters of a new card. */
export function addCardParams(
  c: CardCreate,
  opts: { inventoryId: number; priceGroupId: number | null; warehouseId: string | null },
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    inventory_id: opts.inventoryId,
    sku: c.sku,
    text_fields: { name: c.name, ...(c.description ? { description: c.description } : {}) },
  }
  if (c.ean) params.ean = c.ean
  if (c.weightKg !== null && c.weightKg > 0) params.weight = Math.round(c.weightKg * 100) / 100
  if (opts.priceGroupId !== null && c.price !== null) params.prices = { [String(opts.priceGroupId)]: c.price }
  if (opts.warehouseId && c.available !== null) params.stock = { [opts.warehouseId]: c.available }
  if (c.images.length > 0) params.images = Object.fromEntries(c.images.map((url, i) => [String(i), `url:${url}`]))
  return params
}

/** `addInventoryProduct` parameters of an update: only the fields that changed. */
export function updateCardParams(u: NonNullable<CardItem["update"]>, inventoryId: number): Record<string, unknown> {
  const params: Record<string, unknown> = { inventory_id: inventoryId, product_id: Number(u.blProductId) }
  if (u.name !== undefined) params.text_fields = { name: u.name }
  if (u.ean !== undefined) params.ean = u.ean
  return params
}
