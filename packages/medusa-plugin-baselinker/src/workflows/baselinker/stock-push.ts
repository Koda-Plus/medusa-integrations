/**
 * STOCK PUSH RUN (stockSource: "medusa"): what Medusa can sell into the
 * BaseLinker warehouse, plan first.
 *
 * After every complete catalog read: plan with `lib/stock-push.ts`; only when
 * the `stockToBaseLinker` writer is armed (and `stockSync: "write"`), write
 * within `maxStockChangesPerRun`, decreases first, through
 * `updateInventoryProductsStock` (1000 cards per call). A card BaseLinker
 * answers with a warning failed; it counts towards its quarantine. A failed
 * call (an outage) fails its batch without counting against the cards.
 */

import { BULK_UPDATE_MAX, PLUGIN_EVENTS } from "../../modules/baselinker/lib/constants"
import type { CatalogRead } from "../../modules/baselinker/lib/catalog"
import type { RunDto, RunTrigger } from "../../modules/baselinker/lib/contract"
import { DEMO_WAREHOUSE_ID } from "../../modules/baselinker/lib/demo"
import { describeError } from "../../modules/baselinker/lib/errors"
import { selectForApply } from "../../modules/baselinker/lib/quarantine"
import type { StockCard, StockLevel, StockVariant } from "../../modules/baselinker/lib/stock"
import { planStockPush, stockPayload, type PushChange } from "../../modules/baselinker/lib/stock-push"
import { writerState } from "../../modules/baselinker/lib/writers"
import { noteFailures, noteSuccesses, quarantinedKeys, quarantineRows, replacePlan, rowStatus, type Outcome, type PlanItemData } from "./plans"
import { baselinkerService, clientFor, emitEvent, exclusive, recordRun, type Scope } from "./runtime"
import { loadWriters, updateDemoState } from "./settings"
import type { LocationChoice } from "./stock"

export interface StockPushInput {
  trigger: RunTrigger
  read: CatalogRead
  stockCards: StockCard[]
  variants: StockVariant[]
  location: LocationChoice
  levels: StockLevel[]
}

export async function runStockPushPlan(scope: Scope, input: StockPushInput): Promise<RunDto | null> {
  return exclusive(scope, "stock_push", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const startedAt = new Date()
    if (!input.location.id) {
      return recordRun(svc, {
        kind: "stock_push",
        trigger: input.trigger,
        status: "error",
        startedAt,
        message: "No stock location to read Medusa stock from: set stockLocationId, or keep one location in the store.",
        counts: { reason: input.location.reason },
      })
    }
    const plan = planStockPush({ cards: input.stockCards, variants: input.variants, levels: input.levels, complete: input.read.complete })
    if (plan.skipped) {
      return recordRun(svc, {
        kind: "stock_push",
        trigger: input.trigger,
        status: "partial",
        startedAt,
        message: "The BaseLinker read was incomplete, so no stock was planned or written. The previous plan stays.",
        counts: { skipped: plan.skipped },
      })
    }

    const { writers } = await loadWriters(svc)
    const writer = writerState(writers, "stockToBaseLinker")
    const quarantine = await quarantineRows(svc, "stock_push")
    const held = quarantinedKeys(quarantine)
    const selection = writer.live
      ? selectForApply(plan.changes, (c) => c.key, held, o.maxStockChangesPerRun)
      : { apply: [] as PushChange[], overCap: [] as PushChange[], quarantined: plan.changes.filter((c) => held.has(c.key)) }

    const outcomes = new Map<string, Outcome>()
    let callError: string | null = null
    if (selection.apply.length > 0) {
      if (o.demo) {
        await updateDemoState(svc, (s) => {
          for (const c of selection.apply) s.stock[c.blProductId] = c.to
        })
        for (const c of selection.apply) outcomes.set(c.key, { ok: true })
      } else {
        const client = clientFor(svc).forWriter("stockToBaseLinker")
        const warehouse = o.warehouseId
        for (let i = 0; i < selection.apply.length; i += BULK_UPDATE_MAX) {
          const batch = selection.apply.slice(i, i + BULK_UPDATE_MAX)
          if (callError) {
            for (const c of batch) outcomes.set(c.key, { ok: false, error: callError, countable: false })
            continue
          }
          try {
            const res = await client.updateInventoryProductsStock(o.inventoryId as number, stockPayload(batch, warehouse))
            for (const c of batch) {
              const warning = res.warnings[c.blProductId]
              outcomes.set(c.key, warning ? { ok: false, error: warning, countable: true } : { ok: true })
            }
          } catch (err) {
            callError = svc.mask(describeError(err).message)
            for (const c of batch) outcomes.set(c.key, { ok: false, error: callError, countable: false })
          }
        }
      }
    }

    const failed = selection.apply.filter((c) => outcomes.get(c.key)?.ok === false)
    await noteFailures(
      svc,
      "stock_push",
      failed
        .filter((c) => (outcomes.get(c.key) as Extract<Outcome, { ok: false }>).countable)
        .map((c) => ({ key: c.key, label: c.sku ?? c.label, error: (outcomes.get(c.key) as Extract<Outcome, { ok: false }>).error })),
      quarantine,
    )
    await noteSuccesses(
      svc,
      selection.apply.filter((c) => outcomes.get(c.key)?.ok).map((c) => c.key),
      quarantine,
    )

    const overCap = new Set(selection.overCap.map((c) => c.key))
    const now = new Date()
    const rows: PlanItemData[] = plan.changes.map((c) => {
      const outcome = outcomes.get(c.key)
      return {
        itemKey: c.key,
        action: "update",
        status: rowStatus({ applicable: true, outcome, quarantined: held.has(c.key), overCap: overCap.has(c.key) }),
        label: c.label,
        sku: c.sku,
        productId: c.productId,
        variantId: c.variantId,
        blProductId: c.blProductId,
        changes: [{ field: "stock", from: c.from, to: c.to }],
        error: outcome && !outcome.ok ? outcome.error : null,
        appliedAt: outcome?.ok ? now : null,
      }
    })
    const applied = [...outcomes.values()].filter((x) => x.ok).length
    const s = plan.stats
    const mode = writer.live ? "write" : "plan"
    const run = await recordRun(svc, {
      kind: "stock_push",
      trigger: input.trigger,
      status: callError ? "error" : failed.length > 0 || selection.overCap.length > 0 ? "partial" : "ok",
      complete: true,
      startedAt,
      counts: {
        ...s,
        mode,
        warehouseId: o.demo ? DEMO_WAREHOUSE_ID : o.warehouseId,
        locationId: input.location.id,
        applied,
        failed: failed.length,
        overCap: selection.overCap.length,
        quarantined: selection.quarantined.length,
      },
      message:
        mode === "plan"
          ? `Plan only: ${s.toChange} card(s) would change (+${s.unitsAdded} / -${s.unitsRemoved} units), nothing written.`
          : callError
            ? `${applied} card(s) written, then an error: ${callError}`
            : `${applied} card(s) written${failed.length > 0 ? `, ${failed.length} refused by BaseLinker` : ""}${selection.overCap.length > 0 ? `, ${selection.overCap.length} left for the next run` : ""}.`,
    })
    await replacePlan(svc, "stock_push", run.id, rows)
    if (applied > 0) await emitEvent(scope, PLUGIN_EVENTS.planApplied, { kind: "stock_push", applied, failed: failed.length, demo: o.demo })
    return run
  })
}
