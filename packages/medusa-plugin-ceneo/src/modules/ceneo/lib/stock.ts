/**
 * AVAILABLE UNITS OF A VARIANT. Pure, zero imports.
 *
 * The same rule as Medusa's own availability helper: for every inventory
 * item of the variant, the available quantity over the counted locations
 * divided by the quantity the variant needs, rounded down; the variant has
 * the minimum of those. Locations are the stock locations of the feed's
 * sales channel (none linked: nothing counts, as in the store).
 *
 * A variant without any inventory item is absent from the map: the feed
 * reads that as "unknown", never as "in stock" or "sold out".
 */

export interface InventoryLevelInput {
  location_id?: string | null
  available_quantity?: number | string | null
  stocked_quantity?: number | string | null
  reserved_quantity?: number | string | null
}

export interface InventoryLinkInput {
  variant_id?: string | null
  required_quantity?: number | string | null
  inventory?: { location_levels?: Array<InventoryLevelInput | null> | null } | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function levelAvailable(level: InventoryLevelInput): number {
  const available = num(level.available_quantity)
  if (available !== null) return available
  return (num(level.stocked_quantity) ?? 0) - (num(level.reserved_quantity) ?? 0)
}

/** @param locations counted locations, or null for every location */
export function availabilityByVariant(links: readonly InventoryLinkInput[], locations: ReadonlySet<string> | null): Map<string, number> {
  const perItem = new Map<string, number[]>()
  for (const link of links) {
    const variantId = String(link.variant_id ?? "")
    if (!variantId) continue
    const required = Math.max(1, num(link.required_quantity) ?? 1)
    let sum = 0
    for (const level of link.inventory?.location_levels ?? []) {
      if (!level) continue
      if (locations && !locations.has(String(level.location_id ?? ""))) continue
      sum += levelAvailable(level)
    }
    const list = perItem.get(variantId) ?? []
    list.push(Math.floor(sum / required))
    perItem.set(variantId, list)
  }
  const out = new Map<string, number>()
  for (const [variantId, list] of perItem) out.set(variantId, Math.max(0, Math.min(...list)))
  return out
}
