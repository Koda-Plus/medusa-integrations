import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { CheckResult } from "../../modules/fakturownia/lib/contract"
import { checkConnection } from "./check"

/** Harmless reads: the token, the account, the department and the category in one answer. */
export const checkFakturowniaConnectionStep = createStep("fakturownia-check-connection-step", async (_input: Record<string, never>, { container }) => {
  const result: CheckResult | null = await checkConnection(container)
  return new StepResponse(result)
})

export const checkFakturowniaConnectionWorkflow = createWorkflow("fakturownia-check-connection", (input: Record<string, never>) => {
  return new WorkflowResponse(checkFakturowniaConnectionStep(input))
})
