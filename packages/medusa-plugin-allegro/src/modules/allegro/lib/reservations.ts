/**
 * STOCK FOR AN IMPORTED ORDER. Pure arithmetic, zero imports.
 *
 * The reservations themselves are made by Medusa: the order is created as a
 * draft and placed with `convertDraftOrderWorkflow`, which reserves per
 * inventory item in a stock location of the order's sales channel, the way
 * the cart completion does. This file answers the question BEFORE anything
 * is created: can Medusa cover the order at all? An oversell on Allegro
 * shows up here, and the import is held with a reason a person can act on,
 * instead of Medusa refusing the order with a less helpful message.
 */

export interface InventoryLevelLike {
  locationId: string
  stocked: number
  reserved: number
}

export interface VariantInventory {
  variantId: string
  sku: string | null
  manageInventory: boolean
  allowBackorder: boolean
  items: Array<{ inventoryItemId: string; requiredQuantity: number; levels: InventoryLevelLike[] }>
}

export interface ReservationLine {
  /** The Medusa line item id, or a placeholder before the order exists. */
  lineItemId: string
  variantId: string
  quantity: number
}

export interface PlannedReservation {
  line_item_id: string
  inventory_item_id: string
  location_id: string
  quantity: number
  allow_backorder: boolean
}

export function planReservations(
  lines: readonly ReservationLine[],
  variants: ReadonlyMap<string, VariantInventory>,
  channelLocationIds: readonly string[],
): { reservations: PlannedReservation[]; problems: string[] } {
  const reservations: PlannedReservation[] = []
  const problems: string[] = []
  /* What earlier lines of the same order already took, per item and location. */
  const taken = new Map<string, number>()
  const takenKey = (item: string, loc: string) => `${item}@${loc}`

  for (const line of lines) {
    const v = variants.get(line.variantId)
    if (!v) {
      problems.push(`Variant ${line.variantId} no longer exists in Medusa.`)
      continue
    }
    if (!v.manageInventory) continue
    const label = v.sku ?? v.variantId
    if (v.items.length === 0) {
      problems.push(`${label} manages inventory but has no inventory item.`)
      continue
    }
    for (const item of v.items) {
      const needed = Math.max(1, Math.floor(item.requiredQuantity) || 1) * line.quantity
      const levels = item.levels.filter((l) => channelLocationIds.includes(l.locationId))
      if (levels.length === 0) {
        if (!v.allowBackorder) {
          problems.push(`${label}: no stock location of the sales channel holds this item. Link a location to the channel.`)
          continue
        }
        if (channelLocationIds.length === 0) {
          problems.push(`${label}: the sales channel has no stock location.`)
          continue
        }
      }
      const available = (l: InventoryLevelLike) => (Number(l.stocked) || 0) - (Number(l.reserved) || 0) - (taken.get(takenKey(item.inventoryItemId, l.locationId)) ?? 0)
      const enough = levels.find((l) => available(l) >= needed)
      let location = enough?.locationId ?? null
      if (!location) {
        const best = [...levels].sort((a, b) => available(b) - available(a))[0]
        if (!v.allowBackorder) {
          problems.push(
            `${label}: Allegro sold ${needed} and Medusa has ${Math.max(0, best ? available(best) : 0)} available in the channel's locations. This is an oversell: add stock or allow backorders for the variant, then retry.`,
          )
          continue
        }
        location = best?.locationId ?? channelLocationIds[0] ?? null
      }
      if (!location) continue
      taken.set(takenKey(item.inventoryItemId, location), (taken.get(takenKey(item.inventoryItemId, location)) ?? 0) + needed)
      reservations.push({
        line_item_id: line.lineItemId,
        inventory_item_id: item.inventoryItemId,
        location_id: location,
        quantity: needed,
        allow_backorder: v.allowBackorder,
      })
    }
  }
  return { reservations, problems }
}

/**
 * The quantity of an order line as Query returns it. Read right after the
 * order is created, in the same process, `items.quantity` can come back
 * empty (it lives on the versioned item detail), so the detail and the raw
 * value are read as well, and the first positive number wins.
 */
export function itemQuantity(item: { quantity?: unknown; detail?: { quantity?: unknown } | null; raw_quantity?: { value?: unknown } | null } | null | undefined): number {
  for (const v of [item?.quantity, item?.detail?.quantity, item?.raw_quantity?.value]) {
    const n = Number(v)
    if (v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n > 0) return n
  }
  return 0
}
