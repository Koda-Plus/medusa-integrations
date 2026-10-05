import type { MedusaContainer } from "@medusajs/framework/types"
import { PAYMENTS_SCHEDULE } from "../modules/fakturownia/lib/constants"
import { fakturowniaService } from "../workflows/fakturownia/runtime"
import { markFakturowniaPaidWorkflow } from "../workflows/fakturownia/mark-fakturownia-paid"

/**
 * UNPAID DOCUMENTS OF CAPTURED ORDERS BECOME PAID, EVERY 10 MINUTES.
 *
 * The capture subscriber already starts a pass; this job retries what a
 * failed request left behind. Quiet with `markPaidOnCapture: false` or when
 * nothing waits.
 */
export default async function fakturowniaMarkPaidJob(container: MedusaContainer): Promise<void> {
  const svc = fakturowniaService(container)
  if (!svc.isConfigured() || !svc.getOptions().markPaidOnCapture) return
  await markFakturowniaPaidWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "fakturownia-mark-paid",
  schedule: PAYMENTS_SCHEDULE,
}
