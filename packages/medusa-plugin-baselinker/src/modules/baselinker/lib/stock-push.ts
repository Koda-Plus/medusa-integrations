/**
 * STOCK FROM MEDUSA TO THE BASELINKER WAREHOUSE, PLANNED BEFORE ANYTHING IS
 * WRITTEN. Pure, zero imports.
 *
 * For stores where Medusa is the source of stock (`stockSource: "medusa"`).
 * The target of a card is what Medusa can still sell at the stock location:
 *
 *   BaseLinker stock = max(0, stocked - reserved)
 *
 * Absolute values, never deltas: an order Medusa reserved and BaseLinker
 * took off as well is counted once, because the next run writes the number
 * Medusa has, whatever BaseLinker did in between. A missed run or a lost
 * answer fixes itself on the next one.
 *
 * WHAT IS NEVER TOUCHED. Cards in conflict, variants that do not manage
 * inventory, kits (several inventory items, or a quantity per variant other
 * than 1), one inventory item claimed by two cards, variants without a level
 * at the location (unknown is not zero), and everything after an incomplete
 * read of BaseLinker. Cards are compared with the number BaseLinker reported
 * for the warehouse; a card without a number gets one.
 */

export interface PushCard {
  blProductId: string
  variantId: string | null
  conflict: string | null
  /** BaseLinker stock in the configured warehouse; null when the card has no number there. */
  stock: number | null
}

export interface PushVariant {
  id: string
  productId: string | null
  sku: string | null
  productTitle: string | null
  manageInventory: boolean
  inventoryItems: ReadonlyArray<{ inventoryItemId: string; requiredQuantity: number }>
}

export interface PushLevel {
  inventoryItemId: string
  stockedQuantity: number
  reservedQuantity: number
}

export interface PushChange {
  key: string
  blProductId: string
  variantId: string
  productId: string | null
  sku: string | null
  label: string
  /** BaseLinker now (null: no number for the warehouse). */
  from: number | null
  /** What Medusa can still sell. */
  to: number
}

export interface PushPlan {
  skipped: null | "incomplete_read"
  /** Every change, decreases first: when a cap cuts a run, overselling is prevented before stock is added. */
  changes: PushChange[]
  stats: {
    linkedCards: number
    considered: number
    unchanged: number
    toChange: number
    unitsAdded: number
    unitsRemoved: number
    kitsSkipped: number
    notManaged: number
    noInventoryItem: number
    noLevel: number
    sharedItems: number
  }
}

export function planStockPush(input: {
  cards: readonly PushCard[]
  variants: readonly PushVariant[]
  levels: readonly PushLevel[]
  complete: boolean
}): PushPlan {
  const stats = {
    linkedCards: 0,
    considered: 0,
    unchanged: 0,
    toChange: 0,
    unitsAdded: 0,
    unitsRemoved: 0,
    kitsSkipped: 0,
    notManaged: 0,
    noInventoryItem: 0,
    noLevel: 0,
    sharedItems: 0,
  }
  if (!input.complete) return { skipped: "incomplete_read", changes: [], stats }

  const variants = new Map(input.variants.map((v) => [v.id, v]))
  const levels = new Map(input.levels.map((l) => [l.inventoryItemId, l]))
  const byItem = new Map<string, Array<{ card: PushCard; variant: PushVariant }>>()
  for (const card of input.cards) {
    if (card.conflict || !card.variantId) continue
    const variant = variants.get(card.variantId)
    if (!variant) continue
    stats.linkedCards += 1
    if (!variant.manageInventory) {
      stats.notManaged += 1
      continue
    }
    if (variant.inventoryItems.length === 0) {
      stats.noInventoryItem += 1
      continue
    }
    if (variant.inventoryItems.length > 1 || variant.inventoryItems[0].requiredQuantity !== 1) {
      stats.kitsSkipped += 1
      continue
    }
    const itemId = variant.inventoryItems[0].inventoryItemId
    byItem.set(itemId, [...(byItem.get(itemId) ?? []), { card, variant }])
  }

  const changes: PushChange[] = []
  for (const [itemId, claims] of byItem) {
    if (claims.length > 1) {
      stats.sharedItems += claims.length
      continue
    }
    const { card, variant } = claims[0]
    const level = levels.get(itemId)
    if (!level) {
      stats.noLevel += 1
      continue
    }
    stats.considered += 1
    const target = Math.max(0, Math.round(level.stockedQuantity) - Math.max(0, Math.round(level.reservedQuantity)))
    const current = card.stock === null ? null : Math.trunc(card.stock)
    if (current === target) {
      stats.unchanged += 1
      continue
    }
    const delta = target - (current ?? 0)
    if (delta > 0) stats.unitsAdded += delta
    else stats.unitsRemoved += -delta
    changes.push({
      key: `card:${card.blProductId}`,
      blProductId: card.blProductId,
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      label: variant.productTitle ?? variant.sku ?? variant.id,
      from: current,
      to: target,
    })
  }
  changes.sort((a, b) => {
    const da = a.to - (a.from ?? 0)
    const db = b.to - (b.from ?? 0)
    if ((da < 0) !== (db < 0)) return da < 0 ? -1 : 1
    if (da !== db) return da - db
    return (a.sku ?? a.variantId) < (b.sku ?? b.variantId) ? -1 : 1
  })
  stats.toChange = changes.length
  return { skipped: null, changes, stats }
}

/** `updateInventoryProductsStock` products map for one warehouse. */
export function stockPayload(changes: readonly PushChange[], warehouseId: string): Record<string, Record<string, number>> {
  return Object.fromEntries(changes.map((c) => [c.blProductId, { [warehouseId]: c.to }]))
}
