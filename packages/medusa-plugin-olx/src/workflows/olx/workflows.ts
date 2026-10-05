import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { WriterKey } from "../../modules/olx/lib/constants"
import { runOlxCycle, type CycleResult } from "./cycle"
import { runOlxStats, type StatsRunState } from "./refresh-stats"
import { runOlxWriter, type WriterTrigger } from "./run-writer"
import { runOlxThreads, type ThreadsRunState } from "./sync-threads"

/**
 * The 0.2.0 runs as workflows, for the scheduled jobs, the admin and your own
 * code. Each one is a single step: the writes inside are guarded by their own
 * exactly-once rules (claims, lookups, unknown states), so there is nothing a
 * workflow compensation could undo better.
 *
 *   await runOlxCycleWorkflow(container).run({ input: { trigger: "manual" } })
 *   await runOlxWriterWorkflow(container).run({ input: { writer: "lifecycle", dryRun: true } })
 */

export const runOlxCycleStep = createStep("olx-run-cycle-step", async (input: { trigger?: "schedule" | "manual" | "auto" }, { container }) => {
  const result: CycleResult = await runOlxCycle(container, input)
  return new StepResponse(result)
})

export const runOlxCycleWorkflow = createWorkflow("olx-run-cycle", (input: { trigger?: "schedule" | "manual" | "auto" }) => {
  return new WorkflowResponse(runOlxCycleStep(input))
})

export interface RunWriterInput {
  writer: WriterKey
  dryRun?: boolean
  trigger?: WriterTrigger
  actor?: string | null
  overrideGuard?: boolean
}

export const runOlxWriterStep = createStep("olx-run-writer-step", async (input: RunWriterInput, { container }) => {
  return new StepResponse(await runOlxWriter(container, input))
})

export const runOlxWriterWorkflow = createWorkflow("olx-run-writer", (input: RunWriterInput) => {
  return new WorkflowResponse(runOlxWriterStep(input))
})

export const refreshOlxStatsStep = createStep("olx-refresh-stats-step", async (input: { trigger?: string }, { container }) => {
  const result: StatsRunState | null = await runOlxStats(container, input)
  return new StepResponse(result)
})

export const refreshOlxStatsWorkflow = createWorkflow("olx-refresh-stats", (input: { trigger?: string }) => {
  return new WorkflowResponse(refreshOlxStatsStep(input))
})

export const syncOlxThreadsStep = createStep("olx-sync-threads-step", async (input: { trigger?: string }, { container }) => {
  const result: ThreadsRunState | null = await runOlxThreads(container, input)
  return new StepResponse(result)
})

export const syncOlxThreadsWorkflow = createWorkflow("olx-sync-threads", (input: { trigger?: string }) => {
  return new WorkflowResponse(syncOlxThreadsStep(input))
})
