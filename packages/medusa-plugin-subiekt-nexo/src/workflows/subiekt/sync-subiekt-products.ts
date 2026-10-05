import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunDto, RunTrigger } from "../../modules/subiekt/lib/contract"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { toRunDto } from "../../modules/subiekt/lib/dto"
import { applyCatalogPlan, planCatalogFromBridge, storeCatalogPlan } from "./catalog"
import { exclusive, markReachable, markUnreachable, recordRun, subiektService, type Scope } from "./runtime"

/**
 * Products and prices from Subiekt, once: read, plan, store the plan, apply it
 * through the armed writers, record the run. One run per process at a time.
 * Skipped runs from the schedule are not recorded (an hourly "off" says nothing).
 */
export async function runProductSync(scope: Scope, trigger: RunTrigger): Promise<RunDto | null> {
  return exclusive("products", async () => {
    const svc = subiektService(scope)
    const startedAt = new Date()
    try {
      const result = await planCatalogFromBridge(scope)
      if (result.skipped || !result.plan) {
        if (trigger === "schedule") return null
        const row = await recordRun(svc, {
          kind: "products",
          trigger,
          status: result.skipped === "incomplete" ? "error" : "skipped",
          startedAt,
          message: result.message,
          stats: { pages: result.pages, snapshotAt: result.snapshotAt, skipped: result.skipped },
        })
        return toRunDto(row)
      }
      const plan = result.plan
      if (!svc.isDemo()) await markReachable(svc)
      const rows = plan.blocked ? [] : await storeCatalogPlan(svc, plan, `plan_${startedAt.getTime()}`)
      const applied = plan.blocked ? null : await applyCatalogPlan(scope, rows)
      const writing = Boolean(applied && (applied.pricesActive || applied.productsActive))
      const changes = plan.stats.priceChanges + plan.stats.toCreate
      const message = plan.blocked
        ? plan.blocked === "currency_mismatch"
          ? `Price level ${plan.level?.symbol} is in ${plan.level?.currency}, not in ${svc.getOptions().priceCurrency.toUpperCase()}: nothing planned.`
          : `Price level "${svc.getOptions().priceLevel}" does not exist in the bridge: nothing planned.`
        : writing
          ? `${changes} change(s) planned, ${applied!.applied + applied!.simulated} applied${applied!.simulated ? " (simulated)" : ""}, ${applied!.stale} stale, ${applied!.failed} failed, ${applied!.overCap} over the cap.`
          : `${plan.stats.priceChanges} price change(s) and ${plan.stats.toCreate} new product(s) planned. No writer is armed.`
      const row = await recordRun(svc, {
        kind: "products",
        trigger,
        status: plan.blocked ? "skipped" : (applied?.failed ?? 0) > 0 || plan.stats.conflicts > 0 ? "partial" : "success",
        startedAt,
        dryRun: !writing,
        message,
        stats: {
          ...plan.stats,
          ...(applied ?? {}),
          level: plan.level?.symbol ?? null,
          currency: plan.level?.currency ?? null,
          blocked: plan.blocked,
          pages: result.pages,
          snapshotAt: result.snapshotAt,
          samples: plan.samples,
        },
      })
      return toRunDto(row)
    } catch (err) {
      const d = describeError(err)
      if (d.code !== "internal") await markUnreachable(svc, d.message)
      const row = await recordRun(svc, { kind: "products", trigger, status: "error", startedAt, message: `[${d.code}] ${d.message}` })
      svc.getLogger().warn(`[subiekt] Product sync failed: [${d.code}] ${d.message}`)
      return toRunDto(row)
    }
  })
}

export interface SyncProductsInput {
  trigger: RunTrigger
}

export const syncSubiektProductsStep = createStep("subiekt-sync-products", async (input: SyncProductsInput, { container }) => {
  return new StepResponse<RunDto | null>(await runProductSync(container, input.trigger))
})

/**
 * Products and prices from Subiekt to Medusa: plan first, then the armed
 * writers. `null` when a sync already runs in this process.
 */
export const syncSubiektProductsWorkflow = createWorkflow("subiekt-sync-products", (input: SyncProductsInput) => {
  return new WorkflowResponse(syncSubiektProductsStep(input))
})
