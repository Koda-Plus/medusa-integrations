import type { MedusaContainer } from "@medusajs/framework/types"
import { CORRECTIONS_SCHEDULE } from "../modules/fakturownia/lib/constants"
import { scanCorrections } from "../workflows/fakturownia/corrections"
import { fakturowniaService } from "../workflows/fakturownia/runtime"

/**
 * CORRECTION PLANS, EVERY 30 MINUTES: the safety net of the events. Issued
 * invoices of the last 90 days are checked against their orders, the least
 * recently checked first (20 per pass), so a return, a refund or an edit
 * whose event was missed still gets its plan. Reads Medusa only: issuing an
 * approved correction is the outbox's job (every 2 minutes), and only while
 * the corrections writer is armed. Quiet with `corrections: "off"`.
 */
export default async function fakturowniaPlanCorrectionsJob(container: MedusaContainer): Promise<void> {
  const svc = fakturowniaService(container)
  if (!svc.isConfigured() || svc.getOptions().corrections === "off") return
  await scanCorrections(container, "schedule")
}

export const config = {
  name: "fakturownia-plan-corrections",
  schedule: CORRECTIONS_SCHEDULE,
}
