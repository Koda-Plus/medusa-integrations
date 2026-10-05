/**
 * THE STOCK CHECK. Pure arithmetic, zero imports.
 *
 * For every PRIMARY linked offer the check compares what Allegro can still
 * sell with what Medusa has available (stocked minus reserved, in the chosen
 * stock locations). It NEVER changes anything, on either side; it labels each
 * offer so the team sees the gaps before buyers do:
 *
 *   oversell        live on Allegro with MORE items than Medusa has
 *   sold_out        live on Allegro while Medusa has none left
 *   under_listed    live with FEWER items than Medusa has (lost sales)
 *   ended_in_stock  ended on Allegro while Medusa still has the item
 *   ok              the same number on both sides
 *   untracked       the variant does not manage inventory in Medusa
 *   unknown         Allegro did not say how many items the offer has
 *
 * Why only labels: whether Allegro or Medusa is right depends on where the
 * last sale happened, and the plugin cannot know that from two numbers. A
 * sale on Allegro that Medusa has not heard of yet looks exactly like an
 * oversell. Fixing it stays a decision for a person (or the listing tool).
 */

export type StockState =
  | "oversell"
  | "sold_out"
  | "under_listed"
  | "ended_in_stock"
  | "ok"
  | "untracked"
  | "unknown"

/** States worth a red counter: buyers can order items that Medusa does not have. */
export const STOCK_ISSUES: readonly StockState[] = ["oversell", "sold_out"]

export interface InventoryLevel {
  locationId: string
  stocked: number
  reserved: number
}

export interface VariantStockRecord {
  id: string
  manageInventory: boolean
  items: Array<{ requiredQuantity: number; levels: InventoryLevel[] }>
}

/**
 * Items of a variant Medusa can sell right now, or null when Medusa does not
 * track them. A kit (several inventory items) has as many as its scarcest part.
 */
export function availableFor(v: VariantStockRecord, locationIds: readonly string[] | null): number | null {
  if (!v.manageInventory) return null
  if (v.items.length === 0) return null
  let result = Number.POSITIVE_INFINITY
  for (const item of v.items) {
    const levels = locationIds && locationIds.length > 0 ? item.levels.filter((l) => locationIds.includes(l.locationId)) : item.levels
    const available = levels.reduce((sum, l) => sum + (Number(l.stocked) || 0) - (Number(l.reserved) || 0), 0)
    const per = Math.max(1, Math.floor(Number(item.requiredQuantity) || 1))
    result = Math.min(result, Math.floor(available / per))
  }
  return Number.isFinite(result) ? Math.max(0, result) : null
}

export interface CheckedOffer {
  status: string
  /** Allegro quantity, null when the offer carries none. */
  allegro: number | null
  /** Medusa quantity, null when the variant is not tracked. */
  medusa: number | null
}

/** The label of one primary offer, or null when there is nothing to say (drafts, ended without stock). */
export function stockState(o: CheckedOffer): StockState | null {
  const status = String(o.status ?? "").toUpperCase()
  if (status === "INACTIVE") return null
  if (o.medusa === null) return "untracked"
  if (status === "ENDED") return o.medusa > 0 ? "ended_in_stock" : null
  /* ACTIVE and ACTIVATING: buyers can (or are about to) buy. */
  if (o.allegro === null) return "unknown"
  if (o.medusa <= 0) return o.allegro > 0 ? "sold_out" : "ok"
  if (o.allegro > o.medusa) return "oversell"
  if (o.allegro < o.medusa) return "under_listed"
  return "ok"
}

export function isStockIssue(state: string | null | undefined): boolean {
  return state === "oversell" || state === "sold_out"
}
