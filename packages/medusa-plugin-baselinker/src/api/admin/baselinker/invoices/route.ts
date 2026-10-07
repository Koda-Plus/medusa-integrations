import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { InvoiceRowStatus, InvoicesResponse } from "../../../../modules/baselinker/lib/contract"
import { toInvoiceDto, type InvoiceRow } from "../../../../modules/baselinker/lib/dto"
import { baselinkerService, guarded, intParam, strParam } from "../helpers"

const FILTERS: ReadonlyArray<InvoiceRowStatus | "all"> = ["all", "pending", "written", "conflict", "skipped", "failed"]

/**
 * GET /admin/baselinker/invoices?filter=&limit=&offset=
 *
 * Invoice numbers from the Fakturownia plugin and what happened to them in
 * BaseLinker: waiting, written (or found already there), conflict (the field
 * held another value), skipped (the order is not in BaseLinker) or failed.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const raw = strParam(req.query.filter) as InvoiceRowStatus | "all"
  const filter = FILTERS.includes(raw) ? raw : "all"
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (filter !== "all") where.status = filter
  const [rows, count] = (await svc.listAndCountBaseLinkerInvoices(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)) as unknown as [InvoiceRow[], number]
  const body: InvoicesResponse = { invoices: rows.map(toInvoiceDto), count, limit, offset }
  res.json(body)
})
