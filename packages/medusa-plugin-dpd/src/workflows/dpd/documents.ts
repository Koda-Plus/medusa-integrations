/**
 * THE STORED LABELS (dpd_document). generateSpedLabels advises the parcels
 * on every call and DPD does not document a reprint, so a label is asked for
 * once, inside the claim of its row, and stored BEFORE the claim is finished
 * (a claim that lost its lease leaves a harmless document; the GET serves
 * the newest). Every GET serves the stored bytes. The protocols of a
 * dispatch (stage 4) are stored the same way, by dispatch_id.
 *
 * The base64 DPD sent is kept as it came: never logged, never masked (the
 * masking would turn it into "***"), never in a JSON answer.
 */

import type { LabelPage } from "../../modules/dpd/lib/constants"
import { storedProtocolsOf, type DispatchRow, type DocumentRow, type ShipmentRow } from "../../modules/dpd/lib/dto"
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

/* ------------------------------------------------------------------ */
/* The protocols of a dispatch (stage 4)                               */
/* ------------------------------------------------------------------ */

/**
 * A protocol of a dispatch: shipment_id null, dispatch_id set, type
 * "protocol", format "PDF", page null. Like a label it is saved inside the
 * claim, before finishDispatch; dpd_dispatch.protocols is what makes it
 * reachable (E6). It lists the receivers' companies and addresses, so it is
 * served to the admin only and removed after documentRetentionDays.
 */
export async function saveProtocol(scope: Scope, dispatch: DispatchRow, input: { pdfBase64: string; documentId: string | null; actor: string | null }): Promise<DocumentRow> {
  const svc = dpdService(scope)
  const created = await svc.createDpdDocuments({
    shipment_id: null,
    dispatch_id: dispatch.id,
    type: "protocol",
    format: "PDF",
    page: null,
    document_id: input.documentId,
    data: input.pdfBase64,
    mode: dispatch.mode,
    created_by: input.actor ?? "system",
  } as never)
  return created as unknown as DocumentRow
}

/** The document with this id when docId is an entry of dispatch.protocols and the document belongs to this dispatch; null otherwise (never another dispatch's, never one outside the column). */
export async function protocolById(scope: Scope, dispatch: DispatchRow, docId: string): Promise<DocumentRow | null> {
  if (!storedProtocolsOf(dispatch.protocols).some((p) => p.docId === docId)) return null
  const svc = dpdService(scope)
  const rows = (await svc.listDpdDocuments({ id: docId, dispatch_id: dispatch.id, type: "protocol" } as never, { take: 1 } as never)) as unknown as DocumentRow[]
  const doc = rows[0] ?? null
  return doc && doc.dispatch_id === dispatch.id && doc.type === "protocol" ? doc : null
}

/** The newest entry of dispatch.protocols whose document still exists, older entries next; null when none. Never "the newest document by dispatch_id" (E6). */
export async function latestProtocol(scope: Scope, dispatch: DispatchRow): Promise<DocumentRow | null> {
  for (const entry of storedProtocolsOf(dispatch.protocols).reverse()) {
    const doc = await protocolById(scope, dispatch, entry.docId)
    if (doc) return doc
  }
  return null
}

/** The protocol documents of a dispatch without data, newest first (also documents outside the column: callers filter by it). */
export async function protocolsOf(scope: Scope, dispatchId: string): Promise<Array<Omit<DocumentRow, "data">>> {
  const svc = dpdService(scope)
  const rows = (await svc.listDpdDocuments({ dispatch_id: dispatchId, type: "protocol" } as never, {
    take: 200,
    select: DOCUMENT_COLUMNS,
    order: { created_at: "DESC", id: "DESC" },
  } as never)) as unknown as Array<Partial<DocumentRow> & Omit<DocumentRow, "data">>
  return rows.map(({ data: _bytes, ...rest }) => rest)
}

/** The ids of the protocol documents that still exist for these dispatches (one read, no data): an entry of dispatch.protocols without one is left out of the DTO (5.2.5). */
export async function existingProtocolIds(scope: Scope, dispatchIds: readonly string[]): Promise<Set<string>> {
  if (dispatchIds.length === 0) return new Set()
  const svc = dpdService(scope)
  const rows = (await svc.listDpdDocuments({ dispatch_id: [...dispatchIds], type: "protocol" } as never, {
    take: dispatchIds.length * 200,
    select: ["id", "dispatch_id"],
  } as never)) as unknown as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

/** The row with only the protocols whose document still exists. */
export function withExistingProtocols(row: DispatchRow, existing: ReadonlySet<string>): DispatchRow {
  const entries = storedProtocolsOf(row.protocols)
  const kept = entries.filter((p) => existing.has(p.docId))
  return kept.length === entries.length ? row : { ...row, protocols: kept }
}
