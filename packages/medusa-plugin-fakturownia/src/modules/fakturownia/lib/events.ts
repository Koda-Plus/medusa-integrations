/**
 * THE EVENTS OTHER PLUGINS BUILD ON. Zero imports: the contract is plain data.
 *
 * Two events on the Medusa event bus, each emitted ONCE per document row,
 * when the row becomes issued (a successful create, a document adopted after
 * a lost answer, a reconciliation of an `unknown` row, or a person marking it
 * issued with its Fakturownia id):
 *
 *   fakturownia.document.issued     a VAT invoice, a proforma or a receipt
 *   fakturownia.document.corrected  a correction invoice (kind "correction")
 *
 * Both carry the same data (`FakturowniaDocumentEvent`). A correction never
 * emits `fakturownia.document.issued`, so a subscriber that attaches "the
 * invoice of the order" somewhere cannot mistake a correction for it.
 *
 * THE SHAPE IS A CONTRACT: the Allegro and BaseLinker plugins of Koda Plus
 * code against it. Add a new event rather than change this one.
 */

export const DOCUMENT_ISSUED_EVENT = "fakturownia.document.issued"
export const DOCUMENT_CORRECTED_EVENT = "fakturownia.document.corrected"

export type FakturowniaEventKind = "vat" | "proforma" | "receipt" | "correction"

export interface FakturowniaDocumentEvent {
  /** The `fakturownia_document` row id (`fkdoc_...`). */
  id: string
  order_id: string
  kind: FakturowniaEventKind
  /** The number Fakturownia gave the document, like "FV 12/10/2026". */
  number: string | null
  /** The Fakturownia invoice id: `downloadPdf({ externalId, demo })` takes it. */
  external_id: string
  /** A document of the simulated account (demo mode). */
  demo: boolean
}

const KINDS: readonly string[] = ["vat", "proforma", "receipt", "correction"]

export interface EventSourceRow {
  id: string
  order_id: string
  kind: string
  number: string | null
  fakturownia_id: string | null
  demo: boolean
  status: string
}

/**
 * The event of a row, or null when there is nothing to announce: the row is
 * not issued, has no Fakturownia id (a person marked it issued with the
 * number only) or is of a kind outside the contract.
 */
export function documentEvent(row: EventSourceRow): { name: string; data: FakturowniaDocumentEvent } | null {
  if (row.status !== "issued" && row.status !== "needs_correction") return null
  const externalId = String(row.fakturownia_id ?? "").trim()
  if (!/^\d+$/.test(externalId) || !KINDS.includes(row.kind)) return null
  const kind = row.kind as FakturowniaEventKind
  return {
    name: kind === "correction" ? DOCUMENT_CORRECTED_EVENT : DOCUMENT_ISSUED_EVENT,
    data: { id: row.id, order_id: row.order_id, kind, number: row.number ?? null, external_id: externalId, demo: Boolean(row.demo) },
  }
}
