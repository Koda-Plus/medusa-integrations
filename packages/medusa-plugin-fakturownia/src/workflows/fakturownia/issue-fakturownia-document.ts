import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { DocumentRow } from "../../modules/fakturownia/lib/dto"
import { enqueueDue, issueRow, type IssueOutcome } from "./documents"
import { documentsOfOrder, fakturowniaService } from "./runtime"

export interface IssueDocumentInput {
  order_id: string
  /** Queue the document of the trigger without waiting for the trigger, like "Issue now" in the admin. */
  force?: boolean
}

export interface IssueDocumentResult {
  queued: string[]
  outcomes: IssueOutcome[]
}

/**
 * Issues the documents an order needs now, exactly once: the rows are
 * inserted (or found), then each due row is claimed and issued; a document
 * already in Fakturownia is adopted, not duplicated.
 *
 * DELIBERATELY WITHOUT A COMPENSATION. An issued VAT invoice is an accounting
 * document (and, on a KSeF account, a filed one): it can only be corrected,
 * never undone, and a workflow must not pretend otherwise. A retry is safe
 * instead, because every attempt looks the document up first.
 */
export const issueFakturowniaDocumentStep = createStep("fakturownia-issue-document-step", async (input: IssueDocumentInput, { container }) => {
  const queued = await enqueueDue(container, input.order_id, input.force ? "manual" : "workflow", { force: input.force === true })
  const svc = fakturowniaService(container)
  const now = Date.now()
  const due = (await documentsOfOrder(svc, input.order_id)).filter(
    (r: DocumentRow) => r.status === "pending" && (!r.next_attempt_at || new Date(r.next_attempt_at).getTime() <= now),
  )
  const outcomes: IssueOutcome[] = []
  for (const row of due) outcomes.push(await issueRow(container, row))
  const result: IssueDocumentResult = { queued: queued.inserted.map((r) => r.kind), outcomes }
  return new StepResponse(result)
})

export const issueFakturowniaDocumentWorkflow = createWorkflow("fakturownia-issue-document", (input: IssueDocumentInput) => {
  return new WorkflowResponse(issueFakturowniaDocumentStep(input))
})
