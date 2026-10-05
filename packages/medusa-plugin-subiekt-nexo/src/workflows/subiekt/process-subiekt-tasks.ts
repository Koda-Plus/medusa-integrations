import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/subiekt/lib/contract"
import { runDueTasks, type PassStats } from "./tasks"

export interface ProcessTasksInput {
  trigger: RunTrigger
}

export const processSubiektTasksStep = createStep("subiekt-process-tasks", async (input: ProcessTasksInput, { container }) => {
  const stats = await runDueTasks(container, input.trigger)
  return new StepResponse<PassStats | null>(stats)
})

/** One pass over the due tasks (ZK, cancels, WZ). `null` when a pass already runs. */
export const processSubiektTasksWorkflow = createWorkflow("subiekt-process-tasks", (input: ProcessTasksInput) => {
  return new WorkflowResponse(processSubiektTasksStep(input))
})
