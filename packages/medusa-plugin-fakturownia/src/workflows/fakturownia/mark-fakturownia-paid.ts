import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import { markPaidDue, type PaymentsStats } from "./payments"

export interface MarkPaidInput {
  trigger: RunTrigger
}

/** Issued documents of captured orders become paid in Fakturownia (amount checked first). `null` when a pass already runs. */
export const markFakturowniaPaidStep = createStep("fakturownia-mark-paid-step", async (input: MarkPaidInput, { container }) => {
  const stats: PaymentsStats | null = await markPaidDue(container, input.trigger)
  return new StepResponse(stats)
})

export const markFakturowniaPaidWorkflow = createWorkflow("fakturownia-mark-paid", (input: MarkPaidInput) => {
  return new WorkflowResponse(markFakturowniaPaidStep(input))
})
