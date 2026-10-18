/**
 * THE QUANTITY OFFERED, from Medusa inventory: per inventory item the sum
 * of stocked minus reserved over the counted locations, divided by the
 * quantity one variant needs, the lowest item wins (a kit is as available as
 * its scarcest part). A variant whose inventory Medusa does not manage
 * offers the `untrackedStock` option.
 */

export interface StockLevel {
  locationId: string
  stocked: number
  reserved: number
}

export interface VariantStock {
  manageInventory: boolean
  items: Array<{ requiredQuantity: number; levels: StockLevel[] }>
}

export function availableQuantity(v: VariantStock, locationIds: readonly string[] | null, untracked: number): number {
  if (!v.manageInventory) return Math.max(0, Math.floor(untracked))
  if (v.items.length === 0) return 0
  let lowest = Number.POSITIVE_INFINITY
  for (const item of v.items) {
    const levels = locationIds && locationIds.length > 0 ? item.levels.filter((l) => locationIds.includes(l.locationId)) : item.levels
    const free = levels.reduce((sum, l) => sum + Math.max(0, (Number(l.stocked) || 0) - (Number(l.reserved) || 0)), 0)
    const per = Math.max(1, Number(item.requiredQuantity) || 1)
    lowest = Math.min(lowest, Math.floor(free / per))
  }
  return Number.isFinite(lowest) ? Math.max(0, lowest) : 0
}
