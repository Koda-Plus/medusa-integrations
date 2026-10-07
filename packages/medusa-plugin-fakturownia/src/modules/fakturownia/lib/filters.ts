/**
 * THE FILTERS OF THE DOCUMENTS TABLE, as service filters. Zero imports apart
 * from the KSeF statuses and the unpaid rule. One definition for the list of
 * the admin page, its tiles and the counters of the Koda Plus contract, so
 * every number equals the length of the list its link opens.
 */

import type { DocumentFilter } from "./contract"
import { GOV_PROBLEMS } from "./status"
import { unpaidFilters } from "./unpaid"

/** Every KSeF problem status, with the `demo_` twins of the KSeF test environment. */
export const GOV_PROBLEM_VALUES: readonly string[] = [...GOV_PROBLEMS, ...GOV_PROBLEMS.map((s) => `demo_${s}`)]

/** The KSeF statuses meaning "accepted" and "processing", with their `demo_` twins. */
export const GOV_ACCEPTED_VALUES: readonly string[] = ["ok", "demo_ok"]
export const GOV_PROCESSING_VALUES: readonly string[] = ["processing", "demo_processing"]

/** Every filter of the documents table; anything else in `?filter=` reads as "all". */
export const DOCUMENT_FILTERS: readonly DocumentFilter[] = ["all", "pending", "issued", "attention", "unpaid", "ksef", "canceled", "corrections"]

/**
 * The table filter as service filters, in the current mode. The same filters
 * count the tiles of the page and the counters of the Koda Plus contract, so
 * every number equals the length of its list. Alternatives go under `$and`
 * (never a bare `$or`), so a search can be added without replacing them.
 *
 *   attention  failed, unknown or needing a correction, and a proforma of a
 *              canceled order whose rejection Fakturownia refused
 *   unpaid     `lib/unpaid.ts`
 *   ksef       a VAT invoice or correction KSeF rejected (or could not take)
 */
export function documentFilters(filter: DocumentFilter, demo: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = { demo }
  switch (filter) {
    case "pending":
      where.status = ["pending", "issuing"]
      break
    case "issued":
      where.status = "issued"
      break
    case "attention":
      where.$and = [{ $or: [{ status: ["failed", "unknown", "needs_correction"] }, { status: "issued", kind: "proforma", error_code: "reject_failed" }] }]
      break
    case "unpaid":
      return unpaidFilters(demo)
    case "ksef":
      where.status = ["issued", "needs_correction"]
      where.kind = ["vat", "correction"]
      where.gov_status = [...GOV_PROBLEM_VALUES]
      break
    case "canceled":
      where.status = "canceled"
      break
    case "corrections":
      where.kind = "correction"
      break
  }
  return where
}

/** Adds alternatives (a search) to service filters without dropping the ones already there. */
export function withAlternatives(where: Record<string, unknown>, or: Array<Record<string, unknown>>): Record<string, unknown> {
  const and = Array.isArray(where.$and) ? (where.$and as Array<Record<string, unknown>>) : []
  return { ...where, $and: [...and, { $or: or }] }
}
