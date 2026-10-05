import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { syncReturns, type ReturnsStats } from "./returns"

export interface SyncReturnsInput {
  trigger: RunTrigger
}

/** Returns of the BaseLinker return manager into the snapshot (read only, no personal data). Nothing to compensate. */
export const syncBaseLinkerReturnsStep = createStep("baselinker-sync-returns-step", async (input: SyncReturnsInput, { container }) => {
  const stats: ReturnsStats | null = await syncReturns(container, input.trigger)
  return new StepResponse(stats)
})

export const syncBaseLinkerReturnsWorkflow = createWorkflow("baselinker-sync-returns", (input: SyncReturnsInput) => {
  return new WorkflowResponse(syncBaseLinkerReturnsStep(input))
})
