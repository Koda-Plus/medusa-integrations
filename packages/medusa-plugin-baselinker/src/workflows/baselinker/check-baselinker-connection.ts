import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { CheckResult } from "../../modules/baselinker/lib/contract"
import { checkConnection } from "./check"

/** One `getInventories` call: token, catalog and warehouse in one answer. */
export const checkBaseLinkerConnectionStep = createStep("baselinker-check-connection-step", async (_input: Record<string, never>, { container }) => {
  const result: CheckResult | null = await checkConnection(container)
  return new StepResponse(result)
})

export const checkBaseLinkerConnectionWorkflow = createWorkflow("baselinker-check-connection", (input: Record<string, never>) => {
  return new WorkflowResponse(checkBaseLinkerConnectionStep(input))
})
