/**
 * "UNPAID", ONE DEFINITION. Zero imports. The filter of the documents table,
 * its counter, the reminders, the monthly summary and the counters of the
 * Koda Plus contract all read money still to collect the same way:
 *
 *   an issued VAT invoice, receipt or proforma, not paid,
 *   not a correction (it carries no money to collect of its own),
 *   not a proforma already turned into a final document (`converted_at`, or
 *   a final document issued from it: the order's money is counted once),
 *   not a document of a canceled order (`cancel_requested_at`: a proforma is
 *   rejected, a VAT invoice waits for its correction).
 */

export const UNPAID_KINDS: readonly string[] = ["vat", "proforma", "receipt"]

/** Kinds a payment reminder is for: a receipt is paid at the till, a correction has no payment of its own. */
export const REMINDER_KINDS: readonly string[] = ["proforma", "vat"]

/** Service filters of the unpaid documents of a mode. */
export function unpaidFilters(demo: boolean): Record<string, unknown> {
  return { demo, status: "issued", paid: false, kind: [...UNPAID_KINDS], converted_at: null, cancel_requested_at: null }
}

export interface UnpaidRow {
  kind: string
  status: string
  paid: boolean | null
  fakturownia_id?: string | null
  converted_at?: Date | string | null
  cancel_requested_at?: Date | string | null
}

/**
 * The same rule in memory. `convertedIds`: Fakturownia ids of proformas a
 * final document names as its source, for rows of 0.2.x read together.
 */
export function isUnpaid(row: UnpaidRow, convertedIds: ReadonlySet<string> = new Set()): boolean {
  if (row.status !== "issued" || row.paid || !UNPAID_KINDS.includes(row.kind)) return false
  if (row.converted_at || row.cancel_requested_at) return false
  if (row.kind === "proforma" && row.fakturownia_id && convertedIds.has(String(row.fakturownia_id))) return false
  return true
}
