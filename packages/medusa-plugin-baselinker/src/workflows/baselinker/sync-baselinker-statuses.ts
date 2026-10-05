import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { syncStatuses, type StatusesStats } from "./statuses"

export interface SyncStatusesInput {
  trigger: RunTrigger
  /** Only these Medusa orders. Default: every sent order that is not closed. */
  order_ids?: string[]
}

/** Status, tracking and closing fulfillments of sent orders. `null` when a read already runs. */
export const syncBaseLinkerStatusesStep = createStep("baselinker-sync-statuses-step", async (input: SyncStatusesInput, { container }) => {
  const stats: StatusesStats | null = await syncStatuses(container, input.trigger, input.order_ids)
  return new StepResponse(stats)
})

export const syncBaseLinkerStatusesWorkflow = createWorkflow("baselinker-sync-statuses", (input: SyncStatusesInput) => {
  return new WorkflowResponse(syncBaseLinkerStatusesStep(input))
})
