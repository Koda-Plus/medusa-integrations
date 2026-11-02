/**
 * THE STORED LABELS (dpd_document). generateSpedLabels advises the parcels
 * on every call and DPD does not document a reprint, so a label is asked for
 * once, inside the claim of its row, and stored BEFORE the claim is finished
 * (a claim that lost its lease leaves a harmless document; the GET serves
 * the newest). Every GET serves the stored bytes.
 *
 * The base64 DPD sent is kept as it came: never logged, never masked (the
 * masking would turn it into "***"), never in a JSON answer.
 */

import type { LabelPage } from "../../modules/dpd/lib/constants"
import type { DocumentRow, ShipmentRow } from "../../modules/dpd/lib/dto"
import { dpdService, type Scope } from "./runtime"

const DOCUMENT_COLUMNS = ["id", "shipment_id", "dispatch_id", "type", "format", "page", "document_id", "mode", "created_by", "created_at"]

export async function saveLabel(
  scope: Scope,
  row: ShipmentRow,
  input: { pdfBase64: string; page: LabelPage; documentId: string | null; actor: string | null },
): Promise<DocumentRow> {
  const svc = dpdService(scope)
  const created = await svc.createDpdDocuments({
    shipment_id: row.id,
    dispatch_id: null,
    type: "label",
    format: "PDF",
    page: input.page,
    document_id: input.documentId,
    data: input.pdfBase64,
    mode: row.mode,
    created_by: input.actor ?? "system",
  } as never)
  return created as unknown as DocumentRow
}

/** The newest label of a shipment, with its data. */
export async function latestLabel(scope: Scope, shipmentId: string): Promise<DocumentRow | null> {
  const svc = dpdService(scope)
  const rows = (await svc.listDpdDocuments({ shipment_id: shipmentId, type: "label" } as never, { take: 1, order: { created_at: "DESC", id: "DESC" } } as never)) as unknown as DocumentRow[]
  return rows[0] ?? null
}

/** The documents of a shipment without data (select without "data"), newest first. */
export async function documentsOf(scope: Scope, shipmentId: string): Promise<Array<Omit<DocumentRow, "data">>> {
  const svc = dpdService(scope)
  const rows = (await svc.listDpdDocuments({ shipment_id: shipmentId } as never, { take: 50, select: DOCUMENT_COLUMNS, order: { created_at: "DESC", id: "DESC" } } as never)) as unknown as Array<
    Partial<DocumentRow> & Omit<DocumentRow, "data">
  >
  /* A store that ignores `select` still never hands the bytes on. */
  return rows.map(({ data: _bytes, ...rest }) => rest)
}
