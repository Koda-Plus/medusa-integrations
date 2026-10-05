import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { DocumentDto, OrderResult } from "../../modules/subiekt/lib/contract"
import { toDocumentDto } from "../../modules/subiekt/lib/dto"
import { buildSubmission, recordDocument, type OrderSubmission } from "./orders"
import { bridgeFor, markReachable, subiektService } from "./runtime"

export interface SendOrderInput {
  order_id: string
}

export interface SendOrderResult {
  order_id: string
  skipped: null | "order_canceled"
  created: boolean
  document: DocumentDto | null
  warnings: string[]
  omitted: Array<{ line_id: string; title: string | null }>
}

/** Reads the order and builds the contract payload (prices, codes, payment). */
export const prepareSubiektOrderStep = createStep("subiekt-prepare-order", async (input: SendOrderInput, { container }) => {
  return new StepResponse(await buildSubmission(container, input.order_id))
})

/**
 * Creates the ZK through the bridge.
 *
 * DELIBERATELY WITHOUT A COMPENSATION. The ERP recipe compensates a remote
 * create by deleting the remote record. Here the bridge is idempotent per
 * order id, so if a later step fails, the retry gets the SAME ZK back instead
 * of a second one. Deleting would be worse: the warehouse may already be
 * picking from it, and a deleted ZK number leaves a hole in the series.
 */
export const createSubiektOrderStep = createStep("subiekt-create-zk", async (submission: OrderSubmission, { container }) => {
  if (submission.skip || !submission.payload) return new StepResponse<OrderResult | null>(null)
  const result = await bridgeFor(container).createOrder(submission.payload)
  return new StepResponse<OrderResult | null>(result)
})

/** Stores the ZK, writes its number into the order metadata, emits `subiekt.document_issued`. */
export const recordSubiektOrderStep = createStep(
  "subiekt-record-zk",
  async (input: { submission: OrderSubmission; result: OrderResult | null }, { container }) => {
    const { submission, result } = input
    if (!result) {
      return new StepResponse<SendOrderResult>({
        order_id: submission.orderId,
        skipped: submission.skip,
        created: false,
        document: null,
        warnings: [],
        omitted: submission.omitted,
      })
    }
    const { row } = await recordDocument(container, { orderId: submission.orderId, document: result.document, source: "bridge", allowFulfillment: false })
    await markReachable(subiektService(container))
    return new StepResponse<SendOrderResult>({
      order_id: submission.orderId,
      skipped: null,
      created: result.created,
      document: toDocumentDto(row),
      warnings: result.warnings ?? [],
      omitted: submission.omitted,
    })
  },
)

/**
 * Sends one Medusa order to Subiekt as a ZK (zamowienie od klienta).
 * The task queue runs it after `order.placed` (or after the capture for
 * prepaid providers); run it from your own code the same way:
 *
 *   await sendOrderToSubiektWorkflow(container).run({ input: { order_id } })
 */
export const sendOrderToSubiektWorkflow = createWorkflow("subiekt-send-order", (input: SendOrderInput) => {
  const submission = prepareSubiektOrderStep(input)
  const result = createSubiektOrderStep(submission)
  const recorded = recordSubiektOrderStep({ submission, result })
  return new WorkflowResponse(recorded)
})
