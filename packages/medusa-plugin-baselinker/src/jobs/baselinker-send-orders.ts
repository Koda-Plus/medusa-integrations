import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDERS_SCHEDULE } from "../modules/baselinker/lib/constants"
import { canExportOrders, canWriteInvoiceNumbers } from "../modules/baselinker/lib/options"
import { processDueInvoices } from "../workflows/baselinker/invoices"
import { baselinkerService } from "../workflows/baselinker/runtime"
import { processBaseLinkerOrdersWorkflow } from "../workflows/baselinker/process-baselinker-orders"
import { refreshDemoStatuses } from "../workflows/baselinker/statuses"

/**
 * THE ORDER OUTBOX, EVERY 2 MINUTES: due orders, including the retries of
 * earlier failures. The subscriber already sends right after `order.placed`;
 * this job is the safety net and the retry clock. Quiet when nothing is due
 * (an empty pass makes no request and records no run).
 *
 * Since 0.2 the same clock writes the due invoice numbers (only while the
 * `invoiceNumbers` writer is armed).
 *
 * In demo mode it also lets the simulated warehouse move orders on, so
 * statuses change within minutes, as they would on a busy account.
 */
export default async function baselinkerSendOrdersJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  const o = svc.getOptions()
  if (canExportOrders(o)) await processBaseLinkerOrdersWorkflow(container).run({ input: { trigger: "schedule" } })
  if (canWriteInvoiceNumbers(o)) await processDueInvoices(container, "schedule")
  if (o.demo) await refreshDemoStatuses(container)
}

export const config = {
  name: "baselinker-send-orders",
  schedule: ORDERS_SCHEDULE,
}
