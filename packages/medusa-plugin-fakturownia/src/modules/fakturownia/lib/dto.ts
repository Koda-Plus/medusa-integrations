/**
 * Database rows as the generated service (or a raw `RETURNING *`) returns
 * them, and their admin DTOs. Dates leave as ISO strings; no table stores a
 * secret or buyer data.
 */

import type { DocumentDto, DocumentKind, DocumentPositionDto, DocumentStatus, EmailStatus, RunDto } from "./contract"
import { canIssueAgain, canMarkIssued, canReconcile, canRetry } from "./outbox"
import { govState } from "./status"

export interface DocumentRow {
  id: string
  order_id: string
  display_id: number | null
  kind: string
  status: string
  demo: boolean
  fakturownia_id: string | null
  number: string | null
  oid: string | null
  issue_date: string | null
  currency: string | null
  /** A `numeric` column: the pg driver may hand it over as a string. */
  total_gross: number | string | null
  positions: unknown
  buyer_type: string | null
  from_fakturownia_id: string | null
  paid: boolean
  paid_at: Date | string | null
  pay_requested_at: Date | string | null
  gov_status: string | null
  gov_id: string | null
  gov_error: string | null
  gov_checked_at: Date | string | null
  error: string | null
  error_code: string | null
  attempts: number
  next_attempt_at: Date | string | null
  claim_token: string | null
  claimed_at: Date | string | null
  lease_until: Date | string | null
  issued_at: Date | string | null
  cancel_requested_at: Date | string | null
  email_status: string | null
  emailed_at: Date | string | null
  email_error: string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export interface RunRow {
  id: string
  kind: string
  source: string
  trigger: string
  status: string
  complete: boolean
  counts: Record<string, unknown> | null
  message: string | null
  duration_ms: number
  started_at: Date | string
  finished_at: Date | string | null
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

const KINDS: readonly string[] = ["vat", "proforma", "receipt"]
const STATUSES: readonly string[] = ["pending", "issuing", "issued", "failed", "unknown", "canceled", "needs_correction"]
const EMAIL: readonly string[] = ["pending", "sent", "failed"]

function amount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function positionsOf(v: unknown): DocumentPositionDto[] {
  const raw = typeof v === "string" ? safeJson(v) : v
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
    .map((p) => ({
      name: String(p.name ?? ""),
      code: p.code === null || p.code === undefined ? null : String(p.code),
      quantity: Number(p.quantity) || 0,
      unit: String(p.unit ?? ""),
      gross: Number(p.gross) || 0,
      tax: String(p.tax ?? ""),
    }))
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * @param accountUrl The account panel address in live mode (null in demo mode),
 *   for "Open in Fakturownia". It never carries the token.
 */
export function toDocumentDto(r: DocumentRow, accountUrl: string | null = null): DocumentDto {
  const status = (STATUSES.includes(r.status) ? r.status : "pending") as DocumentStatus
  const live = !r.demo && accountUrl !== null
  const remoteId = r.fakturownia_id && /^\d+$/.test(r.fakturownia_id) ? r.fakturownia_id : null
  return {
    id: r.id,
    orderId: r.order_id,
    displayId: r.display_id ?? null,
    kind: (KINDS.includes(r.kind) ? r.kind : "vat") as DocumentKind,
    status,
    fakturowniaId: r.fakturownia_id ?? null,
    number: r.number ?? null,
    oid: r.oid ?? null,
    issueDate: r.issue_date ?? null,
    currency: r.currency ?? null,
    totalGross: amount(r.total_gross),
    positions: positionsOf(r.positions),
    buyerType: r.buyer_type === "company" || r.buyer_type === "person" ? r.buyer_type : null,
    fromFakturowniaId: r.from_fakturownia_id ?? null,
    paid: Boolean(r.paid),
    paidAt: iso(r.paid_at),
    govStatus: r.gov_status ?? null,
    govState: govState(r.gov_status),
    govId: r.gov_id ?? null,
    govError: r.gov_error ?? null,
    govCheckedAt: iso(r.gov_checked_at),
    error: r.error ?? null,
    errorCode: r.error_code ?? null,
    attempts: r.attempts ?? 0,
    nextAttemptAt: iso(r.next_attempt_at),
    issuedAt: iso(r.issued_at),
    cancelRequestedAt: iso(r.cancel_requested_at),
    emailStatus: (r.email_status && EMAIL.includes(r.email_status) ? r.email_status : null) as EmailStatus | null,
    emailedAt: iso(r.emailed_at),
    emailError: r.email_error ?? null,
    demo: Boolean(r.demo),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    fakturowniaUrl: live && remoteId && (status === "issued" || status === "needs_correction" || status === "canceled") ? `${accountUrl}/invoices/${remoteId}` : null,
    actions: {
      retry: canRetry(status),
      reconcile: canReconcile(status) && !r.demo,
      issueAgain: canIssueAgain(status),
      markIssued: canMarkIssued(status),
      pdf: live && Boolean(remoteId) && status !== "pending" && status !== "issuing",
    },
  }
}

export function toRunDto(r: RunRow): RunDto {
  const kind = r.kind === "payments" || r.kind === "statuses" ? r.kind : "issue"
  return {
    id: r.id,
    kind,
    source: r.source === "demo" ? "demo" : "api",
    trigger: r.trigger === "schedule" || r.trigger === "auto" ? r.trigger : "manual",
    status: r.status === "ok" || r.status === "partial" ? r.status : "error",
    complete: Boolean(r.complete),
    counts: r.counts ?? {},
    message: r.message ?? null,
    durationMs: r.duration_ms ?? 0,
    startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
    finishedAt: iso(r.finished_at),
  }
}
