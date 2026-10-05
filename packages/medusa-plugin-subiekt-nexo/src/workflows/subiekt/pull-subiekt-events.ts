import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/subiekt/lib/contract"
import { pullEvents, type PullStats } from "./events"

export interface PullEventsInput {
  trigger: RunTrigger
}

export const pullSubiektEventsStep = createStep("subiekt-pull-events", async (input: PullEventsInput, { container }) => {
  const stats = await pullEvents(container, input.trigger)
  return new StepResponse<PullStats | null>(stats)
})

/** Reads the bridge event feed from the stored cursor and applies new documents (WZ from the warehouse). */
export const pullSubiektEventsWorkflow = createWorkflow("subiekt-pull-events", (input: PullEventsInput) => {
  return new WorkflowResponse(pullSubiektEventsStep(input))
})
