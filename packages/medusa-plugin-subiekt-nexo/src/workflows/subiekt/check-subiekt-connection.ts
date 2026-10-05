import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/subiekt/lib/contract"
import { checkConnection, type HealthResult } from "./health"

export interface CheckConnectionInput {
  trigger: RunTrigger
}

export const checkSubiektConnectionStep = createStep("subiekt-check-connection", async (input: CheckConnectionInput, { container }) => {
  const result = await checkConnection(container, input.trigger)
  return new StepResponse<HealthResult | null>(result)
})

/** Calls `GET /v1/health` (the bridge logs in to Sfera) and stores the answer. */
export const checkSubiektConnectionWorkflow = createWorkflow("subiekt-check-connection", (input: CheckConnectionInput) => {
  return new WorkflowResponse(checkSubiektConnectionStep(input))
})
