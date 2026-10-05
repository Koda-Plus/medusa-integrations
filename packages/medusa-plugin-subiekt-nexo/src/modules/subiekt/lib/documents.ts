/**
 * SALES DOCUMENTS (FS, PA) EXACTLY ONCE. Pure decisions, tested:
 *
 * - which document an order gets (`salesDocument`: fs, pa, or auto: FS for a
 *   buyer with a valid NIP, PA otherwise), decided once when the task is queued
 *   and frozen in it, so a later change of the order never issues a second one;
 * - what a failed request means. A timeout or a proxy error after the request
 *   left Medusa is UNKNOWN: the bridge may have issued the document. The task
 *   becomes `unknown`, and its next attempt first asks the bridge which
 *   documents the order has (`GET /v1/orders/{id}`) and adopts the one it
 *   finds. Only an answer that proves nothing was written (the bridge was not
 *   reached, or said so with a contract error) is retried as usual.
 *
 * The bridge is idempotent on its own too (it looks for the order tag before
 * it creates), so even a blind retry would not duplicate; the plugin does not
 * rely on that alone.
 */

import type { ContractDocument } from "./contract"
import type { SalesDocumentOption } from "./options"

export type DocumentKind = "fs" | "pa"

export function decideDocumentKind(option: SalesDocumentOption, buyerNip: string | null): DocumentKind | null {
  switch (option) {
    case "fs":
      return "fs"
    case "pa":
      return "pa"
    case "auto":
      return buyerNip ? "fs" : "pa"
    default:
      return null
  }
}

export type DocumentFailure = "unknown" | "retry" | "failed"

/**
 * After a failed `POST /v1/orders/{id}/documents`:
 * - `retry`: nothing was written (the bridge was not reached, it was busy, or
 *   it answered with a contract error saying so),
 * - `unknown`: the request may have been processed (timeout, a proxy error,
 *   an unreadable answer, an unexpected bridge error),
 * - `failed`: a person must look (for example Subiekt refused the document).
 */
export function classifyDocumentFailure(code: string, retryable: boolean): DocumentFailure {
  if (code === "timeout" || code === "bridge_unavailable" || code === "invalid_response" || code === "internal") return "unknown"
  if (code === "bridge_unreachable" || code === "busy" || code === "subiekt_unavailable" || code === "order_not_found") return "retry"
  return retryable ? "retry" : "failed"
}

/** The sales document among an order's documents, the oldest one that is not canceled. */
export function findSalesDocument(documents: readonly ContractDocument[]): ContractDocument | null {
  return documents.find((d) => (d.kind === "FS" || d.kind === "PA") && d.status !== "canceled") ?? null
}

/** The capability a document kind needs. */
export function documentCapability(kind: DocumentKind): string {
  return kind === "fs" ? "documents.fs" : "documents.pa"
}
