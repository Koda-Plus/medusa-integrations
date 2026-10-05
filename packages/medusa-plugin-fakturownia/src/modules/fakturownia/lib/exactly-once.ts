/**
 * DOCUMENTS EXACTLY ONCE. Pure orchestration with injected calls, so the unit
 * tests drive it without a network.
 *
 * Four locks, from the database to Fakturownia:
 *
 *   1. ONE ROW PER ORDER AND KIND. A unique index on (order_id, kind, demo)
 *      makes the database refuse a second document of the same kind for one
 *      order, and a partial unique index allows only one final document (VAT
 *      invoice or receipt) per order. Subscribers only insert, and an insert
 *      that meets the index is ignored.
 *   2. ONE SENDER PER ROW. A row is claimed by one atomic UPDATE (pending to
 *      issuing, with a claim token and a lease); two processes cannot both
 *      win it, and the result is written only by the claim's owner.
 *   3. LOOK BEFORE YOU WRITE. Before the create request, the document is
 *      looked up in Fakturownia by its order number (`GET /invoices.json?oid=`,
 *      documented as "Pobranie faktury po Id zamówienia"), and for a document
 *      made from a proforma also by `?from_invoice_id=`. Found and matching:
 *      adopted, nothing is written.
 *   4. ONE SHOT, AND NEVER BLIND. The create request is never repeated. A
 *      timeout, a 5xx or a broken answer means "unknown": a second look a few
 *      seconds later, and if the document still is not there, the row
 *      becomes `unknown`. An unknown row is reconciled (looked up again after
 *      a grace period) before anything is sent again. On top, `oid_unique:
 *      "yes"` makes Fakturownia itself refuse a second document with the
 *      same order number.
 *
 * MATCHING. A candidate must have the exact order number and kind. A
 * candidate issued before the row existed (minus a week) is someone else's
 * (an earlier shop that numbered orders the same way) and is ignored. A
 * candidate with another gross amount is a CONFLICT: never adopted, never
 * duplicated, a person decides.
 */

import { RECONCILE_GRACE_MS, UNKNOWN_RESULT_RECHECK_MS } from "./constants"
import { DocumentConflictError, FakturowniaUnknownResultError } from "./errors"
import { sameAmount, toNumberOrNull } from "./numbers"

/** A Fakturownia document, as much as the plugin reads of it. */
export interface RemoteDocument {
  id: string
  number: string | null
  kind: string
  oid: string | null
  gross: number | null
  currency: string | null
  issueDate: string | null
  paid: number | null
  status: string | null
  govStatus: string | null
  govId: string | null
  govErrors: string | null
  fromInvoiceId: string | null
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  return t.length > 0 ? t : null
}

/** A document of the API answer, or null when it has no id. */
export function toRemoteDocument(raw: unknown): RemoteDocument | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = text(r.id)
  if (!id || !/^\d+$/.test(id)) return null
  const errors = r.gov_error_messages
  return {
    id,
    number: text(r.number),
    kind: (text(r.kind) ?? "").toLowerCase(),
    oid: text(r.oid),
    gross: toNumberOrNull(r.price_gross),
    currency: text(r.currency)?.toUpperCase() ?? null,
    issueDate: text(r.issue_date)?.slice(0, 10) ?? null,
    paid: toNumberOrNull(r.paid),
    status: text(r.status),
    govStatus: text(r.gov_status),
    govId: text(r.gov_id),
    govErrors: Array.isArray(errors) ? errors.map((e) => String(e)).join("; ") || null : text(errors),
    fromInvoiceId: text(r.from_invoice_id),
  }
}

export interface MatchSpec {
  oid: string | null
  /** The API kind ("vat", "proforma", "receipt" or the configured receipt kind). */
  kind: string
  /** Gross total the plugin sent (or would send). Null: any amount matches. */
  totalGross: number | null
  currency: string | null
  /** `YYYY-MM-DD`: candidates issued before it belong to someone else. */
  notBefore: string | null
  /** For a final document made from a proforma: the proforma's Fakturownia id. */
  fromInvoiceId?: string | null
}

export type MatchOutcome =
  | { kind: "match"; doc: RemoteDocument }
  | { kind: "conflict"; doc: RemoteDocument; reason: string }
  | { kind: "none" }

/** Candidates in, the verdict out. Pure. */
export function matchCandidates(candidates: readonly RemoteDocument[], spec: MatchSpec): MatchOutcome {
  const kind = spec.kind.toLowerCase()
  const seen = new Set<string>()
  const ours = candidates.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    if (c.kind !== kind) return false
    const byOid = spec.oid !== null && c.oid !== null && c.oid === spec.oid
    const byProforma = Boolean(spec.fromInvoiceId) && c.fromInvoiceId === spec.fromInvoiceId
    if (!byOid && !byProforma) return false
    if (spec.notBefore && c.issueDate && c.issueDate < spec.notBefore) return false
    return true
  })
  if (ours.length === 0) return { kind: "none" }
  /* The newest first: Fakturownia ids grow (and stay far below 2^53). */
  ours.sort((a, b) => Number(b.id) - Number(a.id))
  if (spec.totalGross === null) return { kind: "match", doc: ours[0] }
  const same = ours.find((c) => sameAmount(c.gross, spec.totalGross, 0.01) && (!spec.currency || !c.currency || c.currency === spec.currency))
  if (same) return { kind: "match", doc: same }
  const other = ours[0]
  return {
    kind: "conflict",
    doc: other,
    reason:
      `Fakturownia already holds ${other.number ?? `document ${other.id}`} with order number ${spec.oid ?? "?"}, ` +
      `but for ${other.gross ?? "?"} ${other.currency ?? ""} instead of ${spec.totalGross} ${spec.currency ?? ""}. `.replace(/ +\./g, ".") +
      "It was not adopted and nothing was issued: check it in Fakturownia, then mark this document as issued or issue it again.",
  }
}

export interface LookupDeps {
  /** `GET /invoices.json?oid=&kind=` over the window, every page. */
  findByOid: (args: { oid: string; kind: string; dateFrom: string | null; dateTo: string | null }) => Promise<RemoteDocument[]>
  /** `GET /invoices.json?from_invoice_id=`, every page. */
  findGeneratedFrom?: (fromInvoiceId: string) => Promise<RemoteDocument[]>
}

/** Every candidate for the document, matched. A failed read throws: "could not look" is never "not there". */
export async function lookupExisting(deps: LookupDeps, spec: MatchSpec, window: { dateFrom: string | null; dateTo: string | null }): Promise<MatchOutcome> {
  const candidates: RemoteDocument[] = []
  if (spec.oid) candidates.push(...(await deps.findByOid({ oid: spec.oid, kind: spec.kind, dateFrom: window.dateFrom, dateTo: window.dateTo })))
  if (spec.fromInvoiceId && deps.findGeneratedFrom) candidates.push(...(await deps.findGeneratedFrom(spec.fromInvoiceId)))
  return matchCandidates(candidates, spec)
}

export interface CreateOnceDeps {
  lookup: () => Promise<MatchOutcome>
  /** ONE create request; resolves with the new document. */
  create: () => Promise<RemoteDocument>
  sleep?: (ms: number) => Promise<void>
  recheckDelayMs?: number
}

export interface CreateOnceResult {
  doc: RemoteDocument
  /** True when the document already existed and was adopted instead of created. */
  adopted: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function conflict(outcome: { doc: RemoteDocument; reason: string }): DocumentConflictError {
  return new DocumentConflictError({ remoteId: outcome.doc.id, remoteNumber: outcome.doc.number, message: outcome.reason })
}

/**
 * Look, then at most one create, then (only after an unknown result) one more
 * look. Throws `FakturowniaUnknownResultError` when the answer was lost and
 * the document is still not visible: the caller marks the row `unknown`.
 */
export async function createOnce(deps: CreateOnceDeps): Promise<CreateOnceResult> {
  const before = await deps.lookup()
  if (before.kind === "match") return { doc: before.doc, adopted: true }
  if (before.kind === "conflict") throw conflict(before)

  let unknown: FakturowniaUnknownResultError
  try {
    return { doc: await deps.create(), adopted: false }
  } catch (err) {
    if (!(err instanceof FakturowniaUnknownResultError)) throw err
    unknown = err
  }

  await (deps.sleep ?? defaultSleep)(deps.recheckDelayMs ?? UNKNOWN_RESULT_RECHECK_MS)
  let after: MatchOutcome | null = null
  try {
    after = await deps.lookup()
  } catch {
    /* The look failed too: still unknown, and the reconciliation looks again. */
  }
  if (after?.kind === "match") return { doc: after.doc, adopted: true }
  throw unknown
}

export type ReconcileVerdict =
  | { action: "wait" }
  | { action: "adopt"; doc: RemoteDocument }
  | { action: "conflict"; reason: string; doc: RemoteDocument }
  /** Certainly not in Fakturownia: the row may be issued again (the attempt looks first, again). */
  | { action: "absent" }

/**
 * The reconciliation of an unknown row. A document that is there is adopted
 * at once. A "not found" is trusted only after the grace period: before it,
 * Fakturownia may still be committing the lost request, so the row waits
 * (also when a person clicked "Check in Fakturownia").
 */
export async function reconcile(args: {
  lookup: () => Promise<MatchOutcome>
  /** When the unknown attempt happened. */
  lastAttemptAt: Date | null
  now: Date
  graceMs?: number
}): Promise<ReconcileVerdict> {
  const grace = args.graceMs ?? RECONCILE_GRACE_MS
  const since = args.lastAttemptAt ? args.now.getTime() - args.lastAttemptAt.getTime() : Number.POSITIVE_INFINITY
  const outcome = await args.lookup()
  if (outcome.kind === "match") return { action: "adopt", doc: outcome.doc }
  if (outcome.kind === "conflict") return { action: "conflict", reason: outcome.reason, doc: outcome.doc }
  if (since < grace) return { action: "wait" }
  return { action: "absent" }
}
