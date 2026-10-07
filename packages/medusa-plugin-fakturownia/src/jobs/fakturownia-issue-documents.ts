import type { MedusaContainer } from "@medusajs/framework/types"
import { ISSUE_SCHEDULE } from "../modules/fakturownia/lib/constants"
import { fakturowniaService } from "../workflows/fakturownia/runtime"
import { issueFakturowniaDocumentsWorkflow } from "../workflows/fakturownia/issue-fakturownia-documents"
import { prepareDemo } from "../workflows/fakturownia/demo"
import { refreshDemoStatuses } from "../workflows/fakturownia/statuses"

/**
 * THE OUTBOX, EVERY 2 MINUTES: claims due rows atomically and issues them,
 * reconciles unknown results by a lookup, turns expired claims into unknown
 * rows. The subscribers already start a pass right after an event; this job
 * is the safety net and the retry clock. Quiet when nothing is due (an empty
 * pass makes no request and records no run).
 *
 * In demo mode it also prepares the sample documents (once) and lets the
 * simulated KSeF accept VAT invoices: the admin's GET routes never write.
 */
export default async function fakturowniaIssueDocumentsJob(container: MedusaContainer): Promise<void> {
  const svc = fakturowniaService(container)
  if (!svc.isConfigured()) return
  if (svc.isDemo()) await prepareDemo(container)
  await issueFakturowniaDocumentsWorkflow(container).run({ input: { trigger: "schedule" } })
  if (svc.isDemo()) await refreshDemoStatuses(container)
}

export const config = {
  name: "fakturownia-issue-documents",
  schedule: ISSUE_SCHEDULE,
}
