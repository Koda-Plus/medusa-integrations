import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SyncResponse } from "../../../../modules/fakturownia/lib/contract"
import { issueDue } from "../../../../workflows/fakturownia/documents"
import { markPaidDue } from "../../../../workflows/fakturownia/payments"
import { inBackground, isRunning } from "../../../../workflows/fakturownia/runtime"
import { refreshStatuses } from "../../../../workflows/fakturownia/statuses"
import { fakturowniaService } from "../helpers"

type What = SyncResponse["what"]

const WHAT: readonly What[] = ["issue", "statuses", "payments"]

/**
 * POST /admin/fakturownia/sync  { "what": "issue" | "statuses" | "payments" }
 *
 * Runs the same code as the scheduled job, now: "Issue pending now",
 * "Refresh statuses", and the payments pass. Answers 202 right away and works
 * in the background; the admin polls GET /admin/fakturownia while the kind is
 * listed in `running`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const o = svc.getOptions()
  const mode = o.demo ? "demo" : "live"
  const what = String((req.body as { what?: unknown } | undefined)?.what ?? "") as What
  if (!WHAT.includes(what)) {
    res.status(400).json({ message: "`what` must be one of: issue, statuses, payments." })
    return
  }
  if (!svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  if (what === "payments" && !o.markPaidOnCapture) {
    res.status(409).json({ message: "Marking documents paid is off (markPaidOnCapture: false)." })
    return
  }
  if (isRunning(what)) {
    const body: SyncResponse = { started: false, alreadyRunning: true, mode, what }
    res.status(202).json(body)
    return
  }
  const run = what === "issue" ? () => issueDue(req.scope, "manual") : what === "payments" ? () => markPaidDue(req.scope, "manual") : () => refreshStatuses(req.scope, "manual")
  inBackground(req.scope, `manual ${what}`, run)
  const body: SyncResponse = { started: true, alreadyRunning: false, mode, what }
  res.status(202).json(body)
}
