import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { DocumentDto } from "../../modules/subiekt/lib/contract"
import { toDocumentDto } from "../../modules/subiekt/lib/dto"
import { recordDocument } from "./orders"
import { bridgeFor, markReachable, subiektService } from "./runtime"

export interface CreateWzInput {
  order_id: string
  fulfillment_id: string
}

export interface CreateWzResult {
  order_id: string
  created: boolean
  document: DocumentDto
}

/** Issues the WZ from the order's ZK and stores it. Never creates a Medusa fulfillment: one already exists. */
export const createSubiektWzStep = createStep("subiekt-create-wz", async (input: CreateWzInput, { container }) => {
  const result = await bridgeFor(container).createFulfillment(input.order_id, { fulfillment_id: input.fulfillment_id })
  const { row } = await recordDocument(container, { orderId: input.order_id, document: result.document, source: "bridge", allowFulfillment: false })
  await markReachable(subiektService(container))
  return new StepResponse<CreateWzResult>({ order_id: input.order_id, created: result.created, document: toDocumentDto(row) })
})

/** A fulfillment created in Medusa becomes a WZ in Subiekt (`issueWzOnFulfillment`). */
export const createSubiektWzWorkflow = createWorkflow("subiekt-create-wz", (input: CreateWzInput) => {
  return new WorkflowResponse(createSubiektWzStep(input))
})
