/**
 * Reads everything a stock sync needs and plans it (`lib/stock.ts`):
 * the whole bridge snapshot, every variant with its inventory items and the
 * current levels at the location that mirrors the Subiekt warehouse.
 */

import type { IInventoryService, IStockLocationService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { STOCK_MAX_PAGES, STOCK_PAGE_SIZE } from "../../modules/subiekt/lib/constants"
import type { StockItem } from "../../modules/subiekt/lib/contract"
import { toNumber } from "../../modules/subiekt/lib/numbers"
import { planStockLevels, type CurrentLevel, type StockPlan, type StockVariant } from "../../modules/subiekt/lib/stock"
import { bridgeFor, queryOf, subiektService, type Scope } from "./runtime"

export interface StockPlanResult {
  skipped: null | "disabled" | "not_configured" | "no_location" | "several_locations"
  message: string | null
  locationId: string | null
  dryRun: boolean
  snapshotAt: string | null
  pages: number
  plan: StockPlan | null
}

async function resolveLocation(scope: Scope, configured: string): Promise<{ id: string | null; reason: StockPlanResult["skipped"] }> {
  if (configured) return { id: configured, reason: null }
  const locations = (scope as { resolve<T>(k: string): T }).resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const list = await locations.listStockLocations({}, { take: 2, select: ["id"] })
  if (list.length === 1) return { id: list[0].id, reason: null }
  return { id: null, reason: list.length === 0 ? "no_location" : "several_locations" }
}

interface VariantRecord {
  id: string
  sku?: string | null
  barcode?: string | null
  ean?: string | null
  upc?: string | null
  manage_inventory?: boolean | null
  inventory_items?: Array<{ inventory_item_id?: string; required_quantity?: unknown; inventory?: { sku?: string | null } | null }> | null
}

async function loadVariants(scope: Scope): Promise<StockVariant[]> {
  const query = queryOf(scope)
  const out: StockVariant[] = []
  const take = 500
  for (let skip = 0; skip < 500_000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "barcode",
        "ean",
        "upc",
        "manage_inventory",
        "inventory_items.inventory_item_id",
        "inventory_items.required_quantity",
        "inventory_items.inventory.sku",
      ],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const v of data as VariantRecord[]) {
      out.push({
        id: v.id,
        sku: v.sku ?? null,
        codes: [v.ean, v.barcode, v.upc],
        manageInventory: v.manage_inventory !== false,
        inventoryItems: (v.inventory_items ?? [])
          .filter((ii) => ii.inventory_item_id)
          .map((ii) => ({
            inventoryItemId: ii.inventory_item_id as string,
            requiredQuantity: toNumber(ii.required_quantity) || 1,
            sku: ii.inventory?.sku ?? null,
          })),
      })
    }
    if (data.length < take) break
  }
  return out
}

async function loadLevels(scope: Scope, locationId: string): Promise<CurrentLevel[]> {
  const inventory = (scope as { resolve<T>(k: string): T }).resolve<IInventoryService>(Modules.INVENTORY)
  // No `select`: stocked_quantity is a BigNumber and comes back empty without its raw twin.
  const levels = await inventory.listInventoryLevels({ location_id: locationId }, { take: null as never })
  return levels.map((l) => ({ id: l.id, inventoryItemId: l.inventory_item_id, stockedQuantity: toNumber(l.stocked_quantity) }))
}

export async function planStock(scope: Scope): Promise<StockPlanResult> {
  const svc = subiektService(scope)
  const o = svc.getOptions()
  const empty = { locationId: null, dryRun: o.demo || o.stockDryRun, snapshotAt: null, pages: 0, plan: null }
  if (!o.stockSyncEnabled) return { ...empty, skipped: "disabled", message: "Stock sync is off (stockSyncEnabled: false)." }
  if (!o.demo && !svc.isConfigured()) return { ...empty, skipped: "not_configured", message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` }

  const location = await resolveLocation(scope, o.stockLocationId)
  if (!location.id) {
    return {
      ...empty,
      skipped: location.reason,
      message:
        location.reason === "no_location"
          ? "The store has no stock location yet."
          : "The store has several stock locations: set stockLocationId to the one that mirrors the Subiekt warehouse.",
    }
  }

  const bridge = bridgeFor(scope)
  const stock: StockItem[] = []
  let cursor: string | null = null
  let pages = 0
  let snapshotAt: string | null = null
  do {
    const page = await bridge.listStock(cursor, STOCK_PAGE_SIZE)
    pages += 1
    snapshotAt = snapshotAt ?? page.snapshot_at
    stock.push(...page.items)
    cursor = page.next_cursor
  } while (cursor && pages < STOCK_MAX_PAGES)

  const [variants, levels] = await Promise.all([loadVariants(scope), loadLevels(scope, location.id)])
  const plan = planStockLevels(stock, variants, levels, { locationId: location.id, field: o.stockField, stripSkuSuffixes: o.stripSkuSuffixes })
  return { skipped: null, message: null, locationId: location.id, dryRun: o.demo || o.stockDryRun, snapshotAt, pages, plan }
}
