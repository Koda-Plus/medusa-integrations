import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import { issueDue, type IssueStats } from "./documents"

export interface IssueDocumentsInput {
  trigger: RunTrigger
}

/** One pass of the outbox: expired leases, unknown rows reconciled, due rows issued. `null` when a pass already runs. */
export const issueFakturowniaDocumentsStep = createStep("fakturownia-issue-documents-step", async (input: IssueDocumentsInput, { container }) => {
  const stats: IssueStats | null = await issueDue(container, input.trigger)
  return new StepResponse(stats)
})

export const issueFakturowniaDocumentsWorkflow = createWorkflow("fakturownia-issue-documents", (input: IssueDocumentsInput) => {
  return new WorkflowResponse(issueFakturowniaDocumentsStep(input))
})
