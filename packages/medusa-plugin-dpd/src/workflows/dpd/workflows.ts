import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { ShipmentRow } from "../../modules/dpd/lib/dto"
import { recordFulfillment } from "./shipments"

/**
 * The flows as Medusa workflows, for your own code:
 *
 *   import { recordDpdFulfillmentWorkflow } from "@koda-plus/medusa-plugin-dpd/workflows"
 *   await recordDpdFulfillmentWorkflow(container).run({ input: { orderId, fulfillmentId } })
 *
 * Stage 1 records rows only; the workflows that send something to DPD come
 * with the stages that talk to it, behind the same writers as the admin.
 */

export type RecordDpdFulfillmentInput = {
  orderId: string
  fulfillmentId: string
}

/** Records the DPD row of a fulfillment (what the subscriber of order.fulfillment_created does). Null for another provider. */
export const recordDpdFulfillmentStep = createStep("dpd-record-fulfillment-step", async (input: RecordDpdFulfillmentInput, { container }) => {
  const row: ShipmentRow | null = await recordFulfillment(container, input.orderId, input.fulfillmentId)
  return new StepResponse(row)
})

export const recordDpdFulfillmentWorkflow = createWorkflow("dpd-record-fulfillment", (input: RecordDpdFulfillmentInput) => {
  return new WorkflowResponse(recordDpdFulfillmentStep(input))
})
