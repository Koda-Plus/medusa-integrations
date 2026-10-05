import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toInvoiceDto, type InvoiceRow } from "../../../../../../modules/baselinker/lib/dto"
import { retryInvoice } from "../../../../../../workflows/baselinker/invoices"
import { baselinkerService } from "../../../helpers"

/**
 * POST /admin/baselinker/invoices/:id/retry
 *
 * Back to the queue with fresh attempts, written right away when the invoice
 * number writer is armed. Safe: the field is read before anything is
 * written, and a field holding another number is never overwritten.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const outcome = await retryInvoice(req.scope, req.params.id)
  const rows = (await svc.listBaseLinkerInvoices({ id: req.params.id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as InvoiceRow[]
  if (!rows[0]) {
    res.status(404).json({ message: "Invoice row not found." })
    return
  }
  res.json({ outcome, invoice: toInvoiceDto(rows[0]) })
}
