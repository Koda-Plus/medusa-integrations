/**
 * STOCK FROM BASELINKER TO MEDUSA, PLANNED BEFORE ANYTHING IS WRITTEN. Pure,
 * zero imports: the input is the card snapshot, the variants with their
 * inventory items and the current levels at one stock location; the output
 * is a plan a person can read, and, only in `write` mode, what to write.
 *
 * WHY A PLAN FIRST. BaseLinker numbers are not always the truth: measured on
 * a production account, one SKU sat on two cards with different stock, some
 * cards held negative stock after overselling, and a nightly import from
 * another shop kept raising zeros back. Writing such numbers into Medusa
 * blindly sells goods the warehouse does not have. The default mode only
 * stores the plan; a person reads it and switches `stockSync` to `write`.
 *
 * THE RULE, ported from production:
 *
 *   target stocked = max(0, BaseLinker stock) + reserved quantity of the level
 *
 * BaseLinker reports what can still be sold, while Medusa keeps `stocked`
 * BEFORE its reservations. Adding the reservations back makes Medusa
 * available equal to BaseLinker: an order already sent to BaseLinker (which
 * took the item off there) keeps its reservation here, and the item does not
 * disappear twice. Negative BaseLinker stock is clamped to zero; without the
 * clamp the same item was rewritten every run in production (BaseLinker -1,
 * Medusa available 0, "different", write, still 0, forever).
 *
 * WHAT IS NEVER TOUCHED. Cards in conflict, variants that do not manage
 * inventory, kits (several inventory items, or a quantity per variant other
 * than 1), one inventory item claimed by two cards, cards without a number
 * for the warehouse, and every item missing from the read: absence is never
 * read as zero. An incomplete read plans nothing at all.
 */

export interface StockCard {
  blProductId: string
  variantId: string | null
  conflict: string | null
  /** Stock in the configured warehouse; null when the card has no number for it. */
  stock: number | null
}

export interface StockVariant {
  id: string
  productId: string | null
  sku: string | null
  productTitle: string | null
  manageInventory: boolean
  inventoryItems: ReadonlyArray<{ inventoryItemId: string; requiredQuantity: number }>
}

export interface StockLevel {
  id: string
  inventoryItemId: string
  stockedQuantity: number
  reservedQuantity: number
}

export interface StockChange {
  variantId: string
  productId: string | null
  sku: string | null
  productTitle: string | null
  blProductId: string
  inventoryItemId: string
  levelId: string | null
  /** Medusa stocked quantity now; null when the item has no level at the location yet. */
  medusaStocked: number | null
  medusaReserved: number
  /** BaseLinker stock as read, negative values included. */
  blStock: number
  target: number
  /** Units added (positive) or removed (negative) by this change. */
  delta: number
  kind: "update" | "create"
  /** Written in this run: `write` mode, complete read, within `maxChanges`. */
  apply: boolean
}

export interface StockPlanInput {
  cards: readonly StockCard[]
  variants: readonly StockVariant[]
  levels: readonly StockLevel[]
  locationId: string
  /** Whether the catalog read was complete. An incomplete read plans nothing. */
  complete: boolean
  mode: "plan" | "write"
  /** Cap of changes written by one run (`maxStockChangesPerRun`). */
  maxChanges: number
  /** How many examples of each skipped kind to keep. */
  sampleSize?: number
}

export interface StockPlanStats {
  linkedCards: number
  considered: number
  unchanged: number
  toChange: number
  toCreate: number
  toUpdate: number
  unitsAdded: number
  unitsRemoved: number
  toApply: number
  overCap: number
  kitsSkipped: number
  notManaged: number
  noInventoryItem: number
  noStockNumber: number
  sharedItems: number
  negativeClamped: number
}

export interface StockPlan {
  skipped: null | "incomplete_read"
  /** Every planned change, decreases first. */
  changes: StockChange[]
  /** Input of `batchInventoryItemLevelsWorkflow`, empty unless something is applied. */
  create: Array<{ inventory_item_id: string; location_id: string; stocked_quantity: number }>
  update: Array<{ id: string; inventory_item_id: string; location_id: string; stocked_quantity: number }>
  stats: StockPlanStats
  samples: { kits: string[]; shared: string[] }
}

/** The production rule. Reserved quantities never go below zero either. */
export function stockTarget(blStock: number, reserved: number): number {
  return Math.max(0, Math.trunc(blStock)) + Math.max(0, Math.round(reserved))
}

function emptyStats(): StockPlanStats {
  return {
    linkedCards: 0,
    considered: 0,
    unchanged: 0,
    toChange: 0,
    toCreate: 0,
    toUpdate: 0,
    unitsAdded: 0,
    unitsRemoved: 0,
    toApply: 0,
    overCap: 0,
    kitsSkipped: 0,
    notManaged: 0,
    noInventoryItem: 0,
    noStockNumber: 0,
    sharedItems: 0,
    negativeClamped: 0,
  }
}

export function planStock(input: StockPlanInput): StockPlan {
  const sample = input.sampleSize ?? 20
  const stats = emptyStats()
  const samples = { kits: [] as string[], shared: [] as string[] }
  if (!input.complete) return { skipped: "incomplete_read", changes: [], create: [], update: [], stats, samples }

  const variants = new Map(input.variants.map((v) => [v.id, v]))
  const levels = new Map(input.levels.map((l) => [l.inventoryItemId, l]))

  /* Which cards pull which inventory item. */
  const byItem = new Map<string, Array<{ card: StockCard; variant: StockVariant }>>()
  for (const card of input.cards) {
    if (card.conflict || !card.variantId) continue
    const variant = variants.get(card.variantId)
    if (!variant) continue
    stats.linkedCards += 1
    if (card.stock === null || !Number.isFinite(card.stock)) {
      stats.noStockNumber += 1
      continue
    }
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
      if (samples.kits.length < sample) samples.kits.push(variant.sku ?? variant.id)
      continue
    }
    const itemId = variant.inventoryItems[0].inventoryItemId
    const list = byItem.get(itemId)
    if (list) list.push({ card, variant })
    else byItem.set(itemId, [{ card, variant }])
  }

  const changes: StockChange[] = []
  for (const [itemId, claims] of byItem) {
    if (claims.length > 1) {
      /* Two variants on one inventory item, each linked to its own card: two
       * answers for one number. Never guessed. */
      stats.sharedItems += claims.length
      if (samples.shared.length < sample) samples.shared.push(claims.map((c) => c.variant.sku ?? c.variant.id).join(" + "))
      continue
    }
    const { card, variant } = claims[0]
    const blStock = Math.trunc(card.stock as number)
    stats.considered += 1
    if (blStock < 0) stats.negativeClamped += 1
    const level = levels.get(itemId) ?? null
    const reserved = level ? Math.max(0, level.reservedQuantity) : 0
    const target = stockTarget(blStock, reserved)
    if (level && level.stockedQuantity === target) {
      stats.unchanged += 1
      continue
    }
    if (!level && target === 0) {
      /* Nothing to sell on either side: a new empty level is only noise. */
      stats.unchanged += 1
      continue
    }
    const current = level ? level.stockedQuantity : 0
    changes.push({
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      productTitle: variant.productTitle,
      blProductId: card.blProductId,
      inventoryItemId: itemId,
      levelId: level?.id ?? null,
      medusaStocked: level ? level.stockedQuantity : null,
      medusaReserved: reserved,
      blStock,
      target,
      delta: target - current,
      kind: level ? "update" : "create",
      apply: false,
    })
  }

  /* Decreases first: when the cap cuts a run short, the changes that prevent
   * overselling go out before the ones that only add stock. */
  changes.sort((a, b) => {
    const da = a.delta < 0 ? 0 : 1
    const db = b.delta < 0 ? 0 : 1
    if (da !== db) return da - db
    if (da === 0 && a.delta !== b.delta) return a.delta - b.delta
    const sa = a.sku ?? a.variantId
    const sb = b.sku ?? b.variantId
    return sa < sb ? -1 : sa > sb ? 1 : 0
  })

  const create: StockPlan["create"] = []
  const update: StockPlan["update"] = []
  const cap = Math.max(0, Math.floor(input.maxChanges))
  changes.forEach((c, i) => {
    if (c.delta > 0) stats.unitsAdded += c.delta
    else stats.unitsRemoved += -c.delta
    if (c.kind === "create") stats.toCreate += 1
    else stats.toUpdate += 1
    if (input.mode !== "write") return
    if (i >= cap) {
      stats.overCap += 1
      return
    }
    c.apply = true
    stats.toApply += 1
    if (c.kind === "create") {
      create.push({ inventory_item_id: c.inventoryItemId, location_id: input.locationId, stocked_quantity: c.target })
    } else {
      update.push({ id: c.levelId as string, inventory_item_id: c.inventoryItemId, location_id: input.locationId, stocked_quantity: c.target })
    }
  })
  stats.toChange = changes.length

  return { skipped: null, changes, create, update, stats, samples }
}
