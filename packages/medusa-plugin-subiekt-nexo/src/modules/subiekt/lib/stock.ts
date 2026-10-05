/**
 * STOCK FROM SUBIEKT TO MEDUSA INVENTORY LEVELS. Pure planning: input is the
 * bridge snapshot, the variants with their inventory items and the current
 * levels at one stock location; output is what to create and update.
 *
 * KEYS. A variant finds its Subiekt product by EAN first (the barcode is
 * unique in practice), then by SKU against the product symbol, both sides
 * normalized. Inventory items that no simple variant reaches (kit components)
 * get a second chance by their own SKU.
 *
 * AMBIGUITY IS NEVER GUESSED. Two Subiekt products with one EAN, or one
 * inventory item pointed at two products with different stock, end up in
 * `conflicts` and stay untouched. A wrong stock level sells goods the
 * warehouse does not have; a skipped one only waits for a fix.
 *
 * ONLY WHAT MATCHED IS WRITTEN. Items missing from the snapshot are left as
 * they are, so a short or partial read can never zero the catalog.
 */

import type { StockItem } from "./contract"
import { normalizeEan, normalizeSku } from "./order-payload"
import { round, toNumber } from "./numbers"

export interface StockVariant {
  id: string
  sku: string | null
  /** EAN, barcode or UPC of the variant, whichever is set. */
  codes: Array<string | null | undefined>
  manageInventory: boolean
  inventoryItems: Array<{ inventoryItemId: string; requiredQuantity: number; sku: string | null }>
}

export interface CurrentLevel {
  id: string
  inventoryItemId: string
  stockedQuantity: number
}

export interface StockPlanOptions {
  locationId: string
  field: "quantity" | "available"
  stripSkuSuffixes: readonly string[]
  /** How many examples of each problem to keep for the admin. */
  sampleSize?: number
}

export interface LevelCreate {
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
}

export interface LevelUpdate {
  id: string
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
}

export interface StockPlan {
  create: LevelCreate[]
  update: LevelUpdate[]
  stats: {
    subiektProducts: number
    variants: number
    matchedItems: number
    matchedByEan: number
    matchedBySku: number
    toCreate: number
    toUpdate: number
    unchanged: number
    unmatchedSubiekt: number
    unmatchedVariants: number
    conflicts: number
    skippedKits: number
  }
  samples: {
    unmatchedSubiekt: string[]
    unmatchedVariants: string[]
    conflicts: string[]
    changes: Array<{ sku: string | null; from: number | null; to: number }>
  }
}

const key = (s: string) => s.trim().toUpperCase()

export function planStockLevels(
  stock: readonly StockItem[],
  variants: readonly StockVariant[],
  levels: readonly CurrentLevel[],
  options: StockPlanOptions,
): StockPlan {
  const sample = options.sampleSize ?? 20

  /* Index Subiekt products. A duplicated key is unusable for matching. */
  const byEan = new Map<string, StockItem | null>()
  const bySymbol = new Map<string, StockItem | null>()
  const conflicts: string[] = []
  for (const item of stock) {
    const ean = normalizeEan(item.ean)
    if (ean) {
      if (byEan.has(ean)) {
        if (byEan.get(ean) !== null) conflicts.push(`EAN ${ean} belongs to several Subiekt products`)
        byEan.set(ean, null)
      } else byEan.set(ean, item)
    }
    const symbol = normalizeSku(item.symbol, [])
    if (symbol) {
      const k = key(symbol)
      if (bySymbol.has(k)) {
        if (bySymbol.get(k) !== null) conflicts.push(`Symbol ${symbol} appears several times in the snapshot`)
        bySymbol.set(k, null)
      } else bySymbol.set(k, item)
    }
  }

  const findBySku = (sku: string | null): StockItem | null => {
    const s = normalizeSku(sku, options.stripSkuSuffixes)
    return s ? bySymbol.get(key(s)) ?? null : null
  }

  /* Target quantity per inventory item. */
  const target = new Map<string, { qty: number; symbol: string; sku: string | null }>()
  const usedSymbols = new Set<string>()
  const unmatchedVariants: string[] = []
  const conflictItems = new Set<string>()
  let matchedByEan = 0
  let matchedBySku = 0
  let skippedKits = 0

  const quantityOf = (item: StockItem) => Math.max(0, round(toNumber(options.field === "available" ? item.available : item.quantity), 3))

  const assign = (inventoryItemId: string, item: StockItem, sku: string | null) => {
    const qty = quantityOf(item)
    const prev = target.get(inventoryItemId)
    if (prev && (prev.symbol !== item.symbol || prev.qty !== qty)) {
      conflictItems.add(inventoryItemId)
      conflicts.push(`Inventory item of ${sku ?? inventoryItemId} matches ${prev.symbol} and ${item.symbol}`)
      return
    }
    target.set(inventoryItemId, { qty, symbol: item.symbol, sku })
    usedSymbols.add(key(item.symbol))
  }

  for (const v of variants) {
    if (!v.manageInventory) continue
    if (v.inventoryItems.length !== 1 || v.inventoryItems[0].requiredQuantity !== 1) {
      if (v.inventoryItems.length > 0) skippedKits += 1
      continue
    }
    const inventoryItemId = v.inventoryItems[0].inventoryItemId
    let item: StockItem | null = null
    for (const code of v.codes) {
      const ean = normalizeEan(code)
      if (ean && byEan.get(ean)) {
        item = byEan.get(ean) ?? null
        break
      }
    }
    if (item) matchedByEan += 1
    else {
      item = findBySku(v.sku)
      if (item) matchedBySku += 1
    }
    if (!item) {
      if (v.sku && unmatchedVariants.length < sample) unmatchedVariants.push(v.sku)
      continue
    }
    assign(inventoryItemId, item, v.sku)
  }

  /* Kit components and inventory items without a simple variant: their own SKU. */
  for (const v of variants) {
    if (!v.manageInventory) continue
    for (const ii of v.inventoryItems) {
      if (target.has(ii.inventoryItemId) || conflictItems.has(ii.inventoryItemId)) continue
      if (v.inventoryItems.length === 1 && ii.requiredQuantity === 1) continue
      const item = findBySku(ii.sku)
      if (item) {
        matchedBySku += 1
        assign(ii.inventoryItemId, item, ii.sku)
      }
    }
  }
  for (const id of conflictItems) target.delete(id)

  const current = new Map(levels.map((l) => [l.inventoryItemId, l]))
  const create: LevelCreate[] = []
  const update: LevelUpdate[] = []
  const changes: StockPlan["samples"]["changes"] = []
  let unchanged = 0
  for (const [inventoryItemId, t] of target) {
    const level = current.get(inventoryItemId)
    if (!level) {
      create.push({ inventory_item_id: inventoryItemId, location_id: options.locationId, stocked_quantity: t.qty })
      if (changes.length < sample) changes.push({ sku: t.sku, from: null, to: t.qty })
    } else if (round(level.stockedQuantity, 3) !== t.qty) {
      update.push({ id: level.id, inventory_item_id: inventoryItemId, location_id: options.locationId, stocked_quantity: t.qty })
      if (changes.length < sample) changes.push({ sku: t.sku, from: level.stockedQuantity, to: t.qty })
    } else unchanged += 1
  }

  const unmatchedSubiekt = stock.filter((s) => !usedSymbols.has(key(s.symbol))).map((s) => s.symbol)

  return {
    create,
    update,
    stats: {
      subiektProducts: stock.length,
      variants: variants.length,
      matchedItems: target.size,
      matchedByEan,
      matchedBySku,
      toCreate: create.length,
      toUpdate: update.length,
      unchanged,
      unmatchedSubiekt: unmatchedSubiekt.length,
      unmatchedVariants: variants.filter((v) => v.manageInventory && v.inventoryItems.length === 1 && !target.has(v.inventoryItems[0].inventoryItemId)).length,
      conflicts: conflicts.length,
      skippedKits,
    },
    samples: {
      unmatchedSubiekt: unmatchedSubiekt.slice(0, sample),
      unmatchedVariants,
      conflicts: conflicts.slice(0, sample),
      changes,
    },
  }
}
