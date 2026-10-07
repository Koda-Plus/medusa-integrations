import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUMMARY_MAX_ROWS, SUMMARY_MONTHS } from "../../../../modules/fakturownia/lib/constants"
import type { SummaryResponse } from "../../../../modules/fakturownia/lib/contract"
import { monthKey, monthlySummary, type SummaryRow } from "../../../../modules/fakturownia/lib/summary"
import { listDocuments } from "../../../../workflows/fakturownia/runtime"
import { fakturowniaService } from "../helpers"

/**
 * GET /admin/fakturownia/summary
 *
 * The last twelve months of the current mode: documents and their value per
 * kind and currency, the unpaid amount, the share KSeF accepted. Reads the
 * database only (at most 25 000 rows; `capped` says when older months may be
 * incomplete).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const now = new Date()
  const from = `${monthKey(now, SUMMARY_MONTHS - 1)}-01`
  const rows = (await listDocuments(svc, { demo: svc.isDemo(), status: ["issued", "needs_correction"], issue_date: { $gte: from } }, {
    take: SUMMARY_MAX_ROWS + 1,
    order: { issue_date: "DESC" },
    select: ["kind", "status", "issue_date", "total_gross", "currency", "paid", "gov_status", "fakturownia_id", "from_fakturownia_id", "converted_at", "cancel_requested_at"],
  })) as unknown as SummaryRow[]
  const body: SummaryResponse = { months: monthlySummary(rows.slice(0, SUMMARY_MAX_ROWS), now, SUMMARY_MONTHS), capped: rows.length > SUMMARY_MAX_ROWS }
  res.json(body)
}
