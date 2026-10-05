import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { DocumentKind } from "../../modules/subiekt/lib/documents"
import { issueSalesDocument, type IssueDocumentResult } from "./sales-documents"

export interface IssueDocumentInput {
  order_id: string
  kind: DocumentKind
  /** Ask the bridge which documents the order has before creating (after an unclear answer). */
  reconcile?: boolean
}

/**
 * Issues the FS or PA of an order through the bridge and stores it.
 *
 * DELIBERATELY WITHOUT A COMPENSATION, like the ZK: a sales document has a
 * number in a fiscal series and may already be on its way to KSeF. The
 * bridge returns the existing one on a retry instead.
 */
export const issueSubiektDocumentStep = createStep("subiekt-issue-document", async (input: IssueDocumentInput, { container }) => {
  return new StepResponse<IssueDocumentResult>(await issueSalesDocument(container, input.order_id, input.kind, Boolean(input.reconcile)))
})

/**
 * The faktura sprzedaży (`fs`) or paragon (`pa`) of an order. The task queue
 * runs it when `salesDocument` says so; run it from your own code the same way:
 *
 *   await issueSubiektDocumentWorkflow(container).run({ input: { order_id, kind: "fs" } })
 */
export const issueSubiektDocumentWorkflow = createWorkflow("subiekt-issue-document", (input: IssueDocumentInput) => {
  return new WorkflowResponse(issueSubiektDocumentStep(input))
})
