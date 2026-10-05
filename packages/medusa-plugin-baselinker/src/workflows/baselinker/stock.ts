/**
 * THE STOCK PLAN (BaseLinker to Medusa), after every complete catalog read:
 * reads the levels at the stock location, plans with `lib/stock.ts`, stores
 * the plan for the admin and, only when the `stockToMedusa` writer writes
 * (`stockSync: "write"` and the arm, see `lib/writers.ts`), applies it with
 * Medusa's own `batchInventoryItemLevelsWorkflow` (a failure rolls its batch
 * back). In demo mode an armed writer applies to the simulation only: the
 * demo store's inventory is never written.
 */

import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
import type { IInventoryService, IStockLocationService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import type { RunDto, RunTrigger } from "../../modules/baselinker/lib/contract"
import { toNumber } from "../../modules/baselinker/lib/numbers"
import { planStock, type StockCard, type StockChange, type StockLevel, type StockVariant } from "../../modules/baselinker/lib/stock"
import { writerState } from "../../modules/baselinker/lib/writers"
import { baselinkerService, exclusive, recordRun, type Scope } from "./runtime"
import { loadDemoState, loadWriters, updateDemoState } from "./settings"

export interface LocationChoice {
  id: string | null
  reason: null | "no_location" | "several_locations" | "unknown_location"
}

/**
 * The configured location, or the only one the store has. In demo mode a
 * store with several locations gets the oldest one: the demo plan is never
 * written, so the choice only decides which numbers the plan compares.
 */
export async function resolveLocation(scope: Scope, configured: string, demo = false): Promise<LocationChoice> {
  const locations = (scope as { resolve<T>(k: string): T }).resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  if (configured) {
    const found = await locations.listStockLocations({ id: configured }, { take: 1, select: ["id"] })
    return found.length === 1 ? { id: configured, reason: null } : { id: null, reason: "unknown_location" }
  }
  const list = await locations.listStockLocations({}, { take: 2, select: ["id"], order: { created_at: "ASC" } })
  if (list.length === 1 || (demo && list.length > 1)) return { id: list[0].id, reason: null }
  return { id: null, reason: list.length === 0 ? "no_location" : "several_locations" }
}

const LOCATION_MESSAGES: Record<Exclude<LocationChoice["reason"], null>, string> = {
  no_location: "The store has no stock location yet, so there is nowhere to put BaseLinker stock.",
  several_locations: "The store has several stock locations: set stockLocationId to the one that receives BaseLinker stock.",
  unknown_location: "stockLocationId does not match any stock location of the store.",
}

/** Every level at the location. No `select`: quantities are BigNumbers and come back empty without their raw twin. */
export async function loadLevels(scope: Scope, locationId: string): Promise<StockLevel[]> {
  const inventory = (scope as { resolve<T>(k: string): T }).resolve<IInventoryService>(Modules.INVENTORY)
  const levels = await inventory.listInventoryLevels({ location_id: locationId }, { take: null as never })
  return levels.map((l) => ({
    id: l.id,
    inventoryItemId: l.inventory_item_id,
    stockedQuantity: Math.round(toNumber(l.stocked_quantity)),
    reservedQuantity: Math.round(toNumber(l.reserved_quantity)),
  }))
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Replaces the stored plan (both modes: switching to a real account starts clean). */
async function replacePlan(
  svc: BaseLinkerModuleService,
  rows: Array<StockChange & { status: string; afterStocked: number | null }>,
  locationId: string,
  runId: string,
): Promise<void> {
  const old = (await svc.listBaseLinkerStockChanges({}, { take: null, select: ["id"] } as never)) as unknown as Array<{ id: string }>
  for (const part of chunks(old.map((r) => r.id), 500)) await svc.deleteBaseLinkerStockChanges(part)
  const demo = svc.isDemo()
  const now = new Date()
  const data = rows.map((c) => ({
    run_id: runId,
    variant_id: c.variantId,
    product_id: c.productId,
    sku: c.sku,
    product_title: c.productTitle,
    bl_product_id: c.blProductId,
    inventory_item_id: c.inventoryItemId,
    location_id: locationId,
    level_id: c.levelId,
    medusa_stocked: c.medusaStocked,
    medusa_reserved: c.medusaReserved,
    bl_stock: c.blStock,
    target: c.target,
    delta: c.delta,
    kind: c.kind,
    status: c.status,
    after_stocked: c.afterStocked,
    applied_at: c.status === "applied" ? now : null,
    demo,
  }))
  for (const part of chunks(data, 500)) await svc.createBaseLinkerStockChanges(part as never)
}

export interface StockRunInput {
  trigger: RunTrigger
  complete: boolean
  cards: StockCard[]
  variants: StockVariant[]
  location: LocationChoice
  levels: StockLevel[]
}

/**
 * Plans (and in `write` mode applies) the stock of one complete catalog
 * read. Returns the recorded run, or null when a plan already runs.
 */
export async function runStockPlan(scope: Scope, input: StockRunInput): Promise<RunDto | null> {
  return exclusive("stock", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const startedAt = new Date()

    if (!input.location.id) {
      return recordRun(svc, {
        kind: "stock",
        trigger: input.trigger,
        status: "error",
        startedAt,
        message: LOCATION_MESSAGES[input.location.reason ?? "no_location"],
        counts: { reason: input.location.reason },
      })
    }
    const locationId = input.location.id
    const { writers } = await loadWriters(svc)
    const mode = writerState(writers, "stockToMedusa").live ? "write" : "plan"
    const demoState = o.demo ? await loadDemoState(svc) : null
    const plan = planStock({
      cards: input.cards,
      variants: input.variants,
      levels: input.levels,
      locationId,
      complete: input.complete,
      mode,
      maxChanges: o.maxStockChangesPerRun,
    })

    if (plan.skipped === "incomplete_read") {
      return recordRun(svc, {
        kind: "stock",
        trigger: input.trigger,
        status: "partial",
        startedAt,
        message: "The catalog read was incomplete, so no stock was planned or written. The previous plan stays.",
        counts: { mode, skipped: "incomplete_read", locationId },
      })
    }

    /* Apply in batches of 200, one Medusa workflow per batch. */
    const status = new Map<StockChange, string>()
    const simulatedKey = (c: StockChange) => `stock:${c.inventoryItemId}:${c.target}`
    for (const c of plan.changes) {
      status.set(c, demoState?.imported[simulatedKey(c)] ? "applied" : mode === "write" ? (c.apply ? "planned" : "over_cap") : "planned")
    }
    let applied = 0
    let applyError: string | null = null
    const after = new Map<string, number>()
    if (mode === "write" && o.demo) {
      /* The simulation: the demo inventory is never written, the plan shows what would be. */
      const at = new Date().toISOString()
      const toApply = plan.changes.filter((c) => c.apply && !demoState?.imported[simulatedKey(c)])
      await updateDemoState(svc, (s) => {
        for (const c of toApply) s.imported[simulatedKey(c)] = at
      })
      for (const c of toApply) status.set(c, "applied")
      applied = toApply.length
    } else if (mode === "write") {
      const toApply = plan.changes.filter((c) => c.apply)
      for (const part of chunks(toApply, 200)) {
        if (applyError) {
          for (const c of part) status.set(c, "failed")
          continue
        }
        try {
          await batchInventoryItemLevelsWorkflow(scope as never).run({
            input: {
              create: part.filter((c) => c.kind === "create").map((c) => ({ inventory_item_id: c.inventoryItemId, location_id: locationId, stocked_quantity: c.target })),
              update: part
                .filter((c) => c.kind === "update")
                .map((c) => ({ id: c.levelId as string, inventory_item_id: c.inventoryItemId, location_id: locationId, stocked_quantity: c.target })),
              delete: [],
            },
          })
          for (const c of part) status.set(c, "applied")
          applied += part.length
        } catch (err) {
          applyError = svc.mask((err as Error)?.message ?? String(err))
          for (const c of part) status.set(c, "failed")
        }
      }
      if (applied > 0) {
        /* Before and after: read the levels back instead of trusting the target. */
        for (const l of await loadLevels(scope, locationId)) after.set(l.inventoryItemId, l.stockedQuantity)
      }
    }

    const s = plan.stats
    const counts: Record<string, unknown> = {
      ...s,
      mode,
      locationId,
      applied,
      failed: [...status.values()].filter((v) => v === "failed").length,
      applyError,
      samples: plan.samples,
    }
    const message =
      mode === "plan"
        ? `Plan only: ${s.toChange} level(s) would change (+${s.unitsAdded} / -${s.unitsRemoved} units), nothing written.`
        : applyError
          ? `${applied} level(s) written, then an error: ${applyError}`
          : `${applied} level(s) written${s.overCap > 0 ? `, ${s.overCap} left for the next run (maxStockChangesPerRun)` : ""}.`
    const run = await recordRun(svc, {
      kind: "stock",
      trigger: input.trigger,
      status: applyError ? "error" : s.overCap > 0 ? "partial" : "ok",
      complete: true,
      startedAt,
      counts,
      message,
    })

    await replacePlan(
      svc,
      plan.changes.map((c) => {
        const st = status.get(c) ?? "planned"
        return { ...c, status: st, afterStocked: st === "applied" ? after.get(c.inventoryItemId) ?? null : null }
      }),
      locationId,
      run.id,
    )
    svc
      .getLogger()
      .info(`[baselinker] stock ${mode}: ${s.toChange} change(s), ${applied} written, ${s.unchanged} unchanged, ${s.kitsSkipped} kit(s) skipped`)
    return run
  })
}
