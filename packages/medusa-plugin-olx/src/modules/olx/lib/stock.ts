/**
 * STOCK OF A VARIANT, AS THE ALERTS AND THE LIFECYCLE WRITER SEE IT. Pure,
 * zero imports.
 *
 * The same rule as Medusa's own availability helper: for every inventory
 * item of the variant, the available quantity over the counted locations
 * divided by the quantity the variant needs, rounded down; the variant has
 * the minimum of those. Locations are every location, or the locations of
 * one sales channel (`salesChannelId`).
 *
 * THREE ANSWERS, NOT TWO. "Sold out" must be a positive fact, because the
 * lifecycle writer ends adverts on it:
 *
 *   tracked     manage_inventory with inventory items: a number, 0 is sold out
 *   untracked   manage_inventory off, or backorders allowed: always sellable
 *   unknown     manage_inventory on but no inventory item at all, or no data:
 *               never an alert, never an action. A store that forgot to set up
 *               inventory must not see every advert ended.
 */

export type StockState = { kind: "tracked"; available: number } | { kind: "untracked" } | { kind: "unknown" }

export interface InventoryLevelInput {
  location_id?: string | null
  available_quantity?: number | string | null
  stocked_quantity?: number | string | null
  reserved_quantity?: number | string | null
}

export interface InventoryLinkInput {
  variant_id?: string | null
  required_quantity?: number | string | null
  inventory?: { location_levels?: InventoryLevelInput[] | null } | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function levelAvailable(level: InventoryLevelInput): number {
  const available = num(level.available_quantity)
  if (available !== null) return available
  const stocked = num(level.stocked_quantity) ?? 0
  const reserved = num(level.reserved_quantity) ?? 0
  return stocked - reserved
}

/**
 * Available units per variant from the `product_variant_inventory_items`
 * link rows. Variants without any link are absent from the map.
 *
 * @param locations counted locations, or null for every location
 */
export function availabilityByVariant(
  links: readonly InventoryLinkInput[],
  locations: ReadonlySet<string> | null,
): Map<string, number> {
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

export function stockState(
  variant: { manageInventory: boolean | null | undefined; allowBackorder: boolean | null | undefined },
  available: number | undefined,
): StockState {
  if (variant.manageInventory === false) return { kind: "untracked" }
  if (variant.allowBackorder === true) return { kind: "untracked" }
  if (available === undefined) return { kind: "unknown" }
  return { kind: "tracked", available: Math.max(0, Math.floor(available)) }
}

/** A positive fact: tracked and nothing left. */
export function isSoldOut(state: StockState): boolean {
  return state.kind === "tracked" && state.available <= 0
}

/** A positive fact: tracked with units, or not tracked at all. */
export function hasStock(state: StockState): boolean {
  return state.kind === "untracked" || (state.kind === "tracked" && state.available > 0)
}

/** Medusa product statuses. Only `published` is visible in the store. */
export function isPublished(status: string | null | undefined): boolean {
  return String(status ?? "") === "published"
}

/** Units for the admin: a number, or null when the variant does not track stock. */
export function stockUnits(state: StockState): number | null {
  return state.kind === "tracked" ? state.available : null
}
