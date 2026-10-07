/**
 * INVOICE NUMBERS INTO BASELINKER ORDERS: the decisions. Pure, zero imports.
 *
 * The Fakturownia plugin of Koda Plus emits `fakturownia.document.issued`
 * with `{ id, order_id, kind, number, external_id, demo }`. For an order that
 * is in BaseLinker the number goes into ONE order field the store chose:
 * `extra_field_1` (default), `extra_field_2` or a custom extra field. There is
 * no invoice number field in `setOrderFields`, and `addInvoice` would issue a
 * second invoice in BaseLinker's own numbering (see docs/baselinker-api-notes.md).
 *
 * Exactly once and never over somebody else's data: the field is read first;
 * empty means write, the same number means it is already there (adopt), any
 * other value means a person decides (conflict). Writing the same value
 * twice is harmless, so an unclear answer is simply read again next time.
 */

export interface DocumentIssued {
  id: string
  order_id: string
  kind: string
  number: string | null
  external_id: string | null
  demo: boolean
}

/** The event data, cleaned; null when it is not a usable document. */
export function parseDocumentIssued(raw: unknown): DocumentIssued | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  const id = typeof d.id === "string" || typeof d.id === "number" ? String(d.id).trim() : ""
  const orderId = typeof d.order_id === "string" ? d.order_id.trim() : ""
  const kind = typeof d.kind === "string" ? d.kind.trim().toLowerCase() : ""
  if (!id || !orderId || !kind) return null
  /* Any code on the event bus can emit this event: only a Medusa order id, a short id and kind, and a
     printable number of at most 100 characters are taken; anything else is not an invoice event. */
  if (id.length > 100 || !/^order_[A-Za-z0-9]{1,60}$/.test(orderId) || !/^[a-z_]{1,30}$/.test(kind)) return null
  const number = typeof d.number === "string" && d.number.trim() ? d.number.trim() : null
  if (number !== null && (number.length > 100 || /[\u0000-\u001f\u007f]/.test(number))) return null
  const external = typeof d.external_id === "string" || typeof d.external_id === "number" ? String(d.external_id) : null
  return { id, order_id: orderId, kind, number, external_id: external, demo: d.demo === true }
}

export type Acceptance = { accept: true } | { accept: false; reason: "kind" | "no_number" | "demo_event_live" }

/** Whether a document's number goes to BaseLinker at all. A simulated document never reaches a real account. */
export function acceptDocument(doc: DocumentIssued, opts: { kinds: readonly string[]; demo: boolean }): Acceptance {
  if (!opts.kinds.includes(doc.kind)) return { accept: false, reason: "kind" }
  if (!doc.number) return { accept: false, reason: "no_number" }
  if (doc.demo && !opts.demo) return { accept: false, reason: "demo_event_live" }
  return { accept: true }
}

/** The current value of the chosen field on a `getOrders` answer (with `include_custom_extra_fields`). */
export function fieldValue(order: Record<string, unknown>, field: string): string | null {
  let raw: unknown
  if (field === "extra_field_1" || field === "extra_field_2") raw = order[field]
  else {
    const m = /^custom:(\d+)$/.exec(field)
    const custom = order.custom_extra_fields
    raw = m && custom && typeof custom === "object" ? (custom as Record<string, unknown>)[m[1]] : undefined
  }
  if (typeof raw === "number") return String(raw)
  return typeof raw === "string" && raw.trim() ? raw.trim() : null
}

/** The extra fields hold 50 characters; a longer number would be cut, which is a conflict waiting to happen. */
export const EXTRA_FIELD_MAX = 50

export type InvoiceDecision = "write" | "adopt" | "conflict" | "too_long"

export function decideInvoiceWrite(current: string | null, number: string, field: string): InvoiceDecision {
  if ((field === "extra_field_1" || field === "extra_field_2") && number.length > EXTRA_FIELD_MAX) return "too_long"
  if (!current) return "write"
  return current.trim().toLowerCase() === number.trim().toLowerCase() ? "adopt" : "conflict"
}
