import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { CancelResult } from "../../modules/subiekt/lib/contract"
import { markDocumentsCanceled } from "./orders"
import { bridgeFor, markReachable, subiektService } from "./runtime"

export interface CancelOrderInput {
  order_id: string
  reason?: string | null
}

/**
 * Asks the bridge to cancel the order's ZK. The answer says honestly when
 * Subiekt needs a person to finish the job (`manual_action_required`):
 * Sfera cannot set every ZK status by itself.
 */
export const cancelSubiektOrderStep = createStep("subiekt-cancel-zk", async (input: CancelOrderInput, { container }) => {
  const result: CancelResult = await bridgeFor(container).cancelOrder(input.order_id, input.reason ?? null)
  if (result.documents?.length) await markDocumentsCanceled(container, input.order_id, result.documents)
  await markReachable(subiektService(container))
  return new StepResponse(result)
})

/** Cancels the ZK of a canceled Medusa order. Idempotent. */
export const cancelOrderInSubiektWorkflow = createWorkflow("subiekt-cancel-order", (input: CancelOrderInput) => {
  return new WorkflowResponse(cancelSubiektOrderStep(input))
})
