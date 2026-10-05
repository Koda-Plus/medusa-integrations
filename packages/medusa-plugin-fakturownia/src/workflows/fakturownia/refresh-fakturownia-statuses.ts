import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import { refreshStatuses, type StatusesStats } from "./statuses"

export interface RefreshStatusesInput {
  trigger: RunTrigger
}

/** KSeF status (read only), waiting e-mails, proforma rejections and missed final documents. `null` when a pass already runs. */
export const refreshFakturowniaStatusesStep = createStep("fakturownia-refresh-statuses-step", async (input: RefreshStatusesInput, { container }) => {
  const stats: StatusesStats | null = await refreshStatuses(container, input.trigger)
  return new StepResponse(stats)
})

export const refreshFakturowniaStatusesWorkflow = createWorkflow("fakturownia-refresh-statuses", (input: RefreshStatusesInput) => {
  return new WorkflowResponse(refreshFakturowniaStatusesStep(input))
})
