import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sellerPanel } from "../../../../../modules/allegro/lib/constants"
import type { AllegroOrderCardResponse } from "../../../../../modules/allegro/lib/contract"
import { toImportDto, toIssueDto, toOutboxDto, type ImportRow, type IssueRow, type OutboxRow } from "../../../../../modules/allegro/lib/dto"
import { ownsOrder } from "../../../../../modules/allegro/lib/integration"
import { armedWriters } from "../../../../../workflows/allegro/writers"
import { allegroService } from "../../helpers"

/**
 * GET /admin/allegro/medusa-orders/:id
 *
 * What Allegro knows about one Medusa order, for the order card: its import
 * row (status, payment, totals, the buyer login and the delivery), the
 * parcels, status and invoices sent for it, and the returns and disputes of
 * its checkout form. Ownership is the import row that names the order, never
 * order metadata: any other order answers `import: null`. Reads only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const id = String(req.params.id ?? "")
  const demo = svc.isDemo()
  const empty: AllegroOrderCardResponse = { mode: demo ? "demo" : "live", import: null, outbox: [], issues: [], writers: { shipping: false, invoices: false } }
  if (!/^[A-Za-z0-9_]{1,64}$/.test(id)) {
    res.status(400).json({ code: "invalid_id", message: "Not an order id." })
    return
  }
  const rows = ((await svc.listAllegroOrderImports({ order_id: id, demo } as never, { take: 5 })) as unknown as ImportRow[]).filter(ownsOrder)
  const row = rows[0]
  if (!row) {
    res.json(empty)
    return
  }
  const outbox = (await svc.listAllegroOutboxes({ order_id: id, demo } as never, { take: 50, order: { created_at: "ASC" } })) as unknown as OutboxRow[]
  const issues = (await svc.listAllegroIssues({ checkout_form_id: row.checkout_form_id, demo } as never, { take: 20, order: { opened_at: "DESC" } })) as unknown as IssueRow[]
  const panel = sellerPanel(svc.getOptions().environment)
  const armed = await armedWriters(svc)
  const body: AllegroOrderCardResponse = {
    mode: empty.mode,
    import: toImportDto(row),
    outbox: outbox.map(toOutboxDto),
    issues: issues.map((r) => toIssueDto(r, r.kind === "return" ? panel.returns : panel.discussions, { id, display_id: row.display_id ?? null })),
    writers: { shipping: armed.has("shipping"), invoices: armed.has("invoices") },
  }
  res.json(body)
}
