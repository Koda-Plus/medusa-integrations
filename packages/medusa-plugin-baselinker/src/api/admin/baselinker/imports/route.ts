import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ImportFilter, ImportsResponse } from "../../../../modules/baselinker/lib/contract"
import { toImportDto, type ImportRow } from "../../../../modules/baselinker/lib/dto"
import { baselinkerService, guarded, intParam, like, strParam } from "../helpers"

const FILTERS: readonly ImportFilter[] = ["all", "pending", "imported", "skipped", "failed", "flagged"]

/**
 * GET /admin/baselinker/imports?filter=&q=&limit=&offset=
 *
 * Marketplace orders found in BaseLinker and what became of them: waiting
 * for the writer, imported (with the Medusa order), skipped (with the
 * reason) or failed. `q` matches a BaseLinker id, a Medusa order number or a
 * marketplace reference. No buyer data: it lives on the Medusa order only.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const raw = strParam(req.query.filter) as ImportFilter
  const filter: ImportFilter = FILTERS.includes(raw) ? raw : "all"
  const q = strParam(req.query.q).replace(/^#/, "").slice(0, 80)

  const and: Array<Record<string, unknown>> = [{ demo: svc.isDemo() }]
  if (filter === "flagged") and.push({ flag: { $ne: null } })
  else if (filter !== "all") and.push({ status: filter })
  if (q) {
    if (/^\d+$/.test(q)) and.push({ $or: [{ bl_order_id: q }, { display_id: Number(q) }] })
    else and.push({ $or: [{ marketplace_ref: { $ilike: like(q) } }, { external_order_id: { $ilike: like(q) } }, { order_id: q }] })
  }
  const [rows, count] = (await svc.listAndCountBaseLinkerImports({ $and: and } as never, {
    take: limit,
    skip: offset,
    order: { confirmed_at: "DESC", created_at: "DESC" },
  } as never)) as unknown as [ImportRow[], number]
  const body: ImportsResponse = { imports: rows.map(toImportDto), count, limit, offset }
  res.json(body)
})
