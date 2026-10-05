/**
 * THE MEDUSA SIDE: variants with a SKU, their available quantity and, for the
 * demo, a price. Read through Query, 500 variants per page.
 */

import type { CatalogVariant } from "../../modules/allegro/lib/matching"
import { availableFor, type VariantStockRecord } from "../../modules/allegro/lib/stock"

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export interface StockedVariant extends CatalogVariant {
  /** Items Medusa can sell now in the chosen locations, null when not tracked. */
  available: number | null
}

interface LevelRecord {
  location_id?: string | null
  stocked_quantity?: number | string | null
  reserved_quantity?: number | string | null
}

interface VariantRecord {
  id: string
  sku?: string | null
  product_id?: string | null
  manage_inventory?: boolean | null
  product?: { title?: string | null } | null
  inventory_items?: Array<{
    required_quantity?: number | string | null
    inventory?: { location_levels?: LevelRecord[] | null } | null
  } | null> | null
}

function stockRecord(raw: VariantRecord): VariantStockRecord {
  return {
    id: raw.id,
    manageInventory: raw.manage_inventory !== false,
    items: (raw.inventory_items ?? [])
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map((i) => ({
        requiredQuantity: Number(i.required_quantity ?? 1) || 1,
        levels: (i.inventory?.location_levels ?? []).map((l) => ({
          locationId: String(l.location_id ?? ""),
          stocked: Number(l.stocked_quantity ?? 0) || 0,
          reserved: Number(l.reserved_quantity ?? 0) || 0,
        })),
      })),
  }
}

/** Every variant with a SKU and its available quantity. */
export async function loadCatalog(query: QueryLike, locationIds: readonly string[]): Promise<StockedVariant[]> {
  const out: StockedVariant[] = []
  const take = 500
  for (let skip = 0; skip < 500_000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "product_id",
        "manage_inventory",
        "product.title",
        "inventory_items.required_quantity",
        "inventory_items.inventory.location_levels.location_id",
        "inventory_items.inventory.location_levels.stocked_quantity",
        "inventory_items.inventory.location_levels.reserved_quantity",
      ],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const raw of data as VariantRecord[]) {
      const sku = String(raw.sku ?? "").trim()
      if (!sku || !raw.product_id) continue
      out.push({
        id: raw.id,
        sku,
        productId: raw.product_id,
        productTitle: raw.product?.title ?? null,
        available: availableFor(stockRecord(raw), locationIds.length > 0 ? locationIds : null),
      })
    }
    if (data.length < take) break
  }
  return out
}

/** Prices of the few variants used by the demo, in PLN when the store has it. Optional. */
export async function demoPrices(query: QueryLike, ids: string[]): Promise<Map<string, { value: number; currency: string }>> {
  const out = new Map<string, { value: number; currency: string }>()
  if (ids.length === 0) return out
  try {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "prices.amount", "prices.currency_code"],
      filters: { id: ids },
    })
    for (const raw of data as Array<{ id: string; prices?: Array<{ amount?: number | string | null; currency_code?: string | null }> | null }>) {
      const prices = (raw.prices ?? []).filter((p) => p && p.amount != null && p.currency_code)
      const pick = prices.find((p) => String(p.currency_code).toLowerCase() === "pln") ?? prices[0]
      if (!pick) continue
      const value = Number(pick.amount)
      if (Number.isFinite(value)) out.set(raw.id, { value, currency: String(pick.currency_code).toUpperCase() })
    }
  } catch {
    /* Prices are decoration in demo mode. */
  }
  return out
}
