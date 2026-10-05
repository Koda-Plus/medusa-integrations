import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toImportDto, type ImportRow } from "../../../../../../modules/baselinker/lib/dto"
import { writerState } from "../../../../../../modules/baselinker/lib/writers"
import { findImportRow, importOrderNow } from "../../../../../../workflows/baselinker/order-import"
import { loadWriters } from "../../../../../../workflows/baselinker/settings"
import { baselinkerService } from "../../../helpers"

/**
 * POST /admin/baselinker/imports/:id/import
 *
 * "Import now" on a waiting, skipped (too old) or failed marketplace order.
 * Needs the order import writer armed. Safe to click twice: the import looks
 * the order up in Medusa (by its BaseLinker id and its marketplace reference)
 * before it creates anything. Answers when the attempt is done.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const { writers } = await loadWriters(svc)
  if (!writerState(writers, "orderImport").live) {
    res.status(409).json({ message: "Arm the order import writer first." })
    return
  }
  const row = await findImportRow(svc, { id: req.params.id })
  if (!row) {
    res.status(404).json({ message: "Import row not found." })
    return
  }
  const outcome = await importOrderNow(req.scope, row.id)
  const fresh = (await findImportRow(svc, { id: row.id })) as ImportRow
  res.json({ outcome, import: toImportDto(fresh) })
}
