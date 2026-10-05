import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { sendOrderNow, type SendOutcome } from "./orders"

export interface SendOrderInput {
  order_id: string
  /** Reset a failed row (attempts, error) before sending, like the "Send again" button. */
  force?: boolean
}

/**
 * Sends one order to BaseLinker now, exactly once: the marker scan adopts an
 * order that is already there, otherwise one `addOrder`.
 *
 * DELIBERATELY WITHOUT A COMPENSATION. Undoing a BaseLinker order would need
 * a write the plugin never does (deleting or changing orders), and it would
 * be worse than the problem: the warehouse may already be packing it. A
 * retry is safe instead, because every attempt scans for the marker first.
 */
export const sendOrderToBaseLinkerStep = createStep("baselinker-send-order-step", async (input: SendOrderInput, { container }) => {
  const outcome: SendOutcome = await sendOrderNow(container, input.order_id, { force: input.force === true })
  return new StepResponse(outcome)
})

export const sendOrderToBaseLinkerWorkflow = createWorkflow("baselinker-send-order", (input: SendOrderInput) => {
  return new WorkflowResponse(sendOrderToBaseLinkerStep(input))
})
