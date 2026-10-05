import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { createStep, createWorkflow, StepResponse, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunDto, RunTrigger } from "../../modules/subiekt/lib/contract"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { toRunDto } from "../../modules/subiekt/lib/dto"
import { planStock, type StockPlanResult } from "./stock-plan"
import { exclusive, markReachable, markUnreachable, recordRun, subiektService, type Scope } from "./runtime"

export interface SyncStockInput {
  trigger: RunTrigger
  started_at: string
}

/** Reads the Subiekt snapshot and plans the inventory level changes. Writes nothing. */
export const planSubiektStockStep = createStep("subiekt-plan-stock", async (_input: SyncStockInput, { container }) => {
  const result = await planStock(container)
  if (!result.skipped) await markReachable(subiektService(container))
  return new StepResponse(result)
})

/** Records the run with counters and examples for the admin. */
export const recordSubiektStockRunStep = createStep(
  "subiekt-record-stock-run",
  async (input: { result: StockPlanResult; trigger: RunTrigger; started_at: string }, { container }) => {
    const svc = subiektService(container)
    const { result } = input
    const plan = result.plan
    const changes = plan ? plan.create.length + plan.update.length : 0
    const row = await recordRun(svc, {
      kind: "stock",
      trigger: input.trigger,
      status: result.skipped ? "skipped" : plan && plan.stats.conflicts > 0 ? "partial" : "success",
      startedAt: new Date(input.started_at),
      dryRun: result.dryRun,
      message: result.skipped
        ? result.message
        : result.dryRun
          ? `Dry run: ${changes} level(s) would change, ${plan?.stats.unchanged ?? 0} already right.`
          : `${changes} level(s) updated, ${plan?.stats.unchanged ?? 0} already right.`,
      stats: plan ? { ...plan.stats, pages: result.pages, snapshotAt: result.snapshotAt, locationId: result.locationId, samples: plan.samples } : null,
    })
    return new StepResponse<RunDto>(toRunDto(row))
  },
)

/**
 * Stock from Subiekt to Medusa: plan, then apply the planned levels with
 * the core `batchInventoryItemLevelsWorkflow` (so a failure rolls the batch
 * back), then record the run. Dry runs and demo mode only record.
 */
export const syncSubiektStockWorkflow = createWorkflow("subiekt-sync-stock", (input: SyncStockInput) => {
  const result = planSubiektStockStep(input)
  const batch = transform({ result }, ({ result }) => ({
    create: result.plan?.create ?? [],
    update: result.plan?.update ?? [],
    delete: [] as string[],
  }))
  when("subiekt-apply-stock", { result }, ({ result }) => {
    return Boolean(result.plan) && !result.dryRun && result.plan!.create.length + result.plan!.update.length > 0
  }).then(() => {
    batchInventoryItemLevelsWorkflow.runAsStep({ input: batch })
  })
  const run = recordSubiektStockRunStep({ result, trigger: input.trigger, started_at: input.started_at })
  return new WorkflowResponse(run)
})

/** Runs the stock workflow once per process at a time and records failures as runs. */
export async function runStockSync(scope: Scope, trigger: RunTrigger): Promise<RunDto | null> {
  return exclusive("stock", async () => {
    const startedAt = new Date()
    const svc = subiektService(scope)
    try {
      const { result } = await syncSubiektStockWorkflow(scope as never).run({ input: { trigger, started_at: startedAt.toISOString() } })
      return result
    } catch (err) {
      const d = describeError(err)
      if (d.code !== "internal") await markUnreachable(svc, d.message)
      const row = await recordRun(svc, { kind: "stock", trigger, status: "error", startedAt, message: `[${d.code}] ${d.message}` })
      svc.getLogger().warn(`[subiekt] Stock sync failed: [${d.code}] ${d.message}`)
      return toRunDto(row)
    }
  })
}
