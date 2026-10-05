import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { sendDueOrders, type OrdersPassStats } from "./orders"

export interface ProcessOrdersInput {
  trigger: RunTrigger
}

/** One pass over the due rows of the order outbox. `null` when a pass already runs. */
export const processBaseLinkerOrdersStep = createStep("baselinker-process-orders-step", async (input: ProcessOrdersInput, { container }) => {
  const stats: OrdersPassStats | null = await sendDueOrders(container, input.trigger)
  return new StepResponse(stats)
})

export const processBaseLinkerOrdersWorkflow = createWorkflow("baselinker-process-orders", (input: ProcessOrdersInput) => {
  return new WorkflowResponse(processBaseLinkerOrdersStep(input))
})
