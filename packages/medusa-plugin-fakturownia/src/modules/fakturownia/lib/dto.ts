/**
 * Database rows as the generated service (or a raw `RETURNING *`) returns
 * them, and their admin DTOs. Dates leave as ISO strings; no table stores a
 * secret or buyer data.
 */

import type {
  BuyerWarningDto,
  CorrectionPlanDto,
  DocumentDto,
  DocumentKind,
  DocumentPositionDto,
  DocumentStatus,
  EmailDto,
  EmailStatus,
  KsefEventDto,
  ManualReason,
  PlanStatus,
  ReasonKind,
  RunDto,
  StoreDocumentDto,
  WriterDto,
} from "./contract"
import { canIssueAgain, canMarkIssued, canReconcile, canRetry } from "./outbox"
import { canResendKsef, goesToKsef, govState } from "./status"

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
  /* 0.2.0 (absent on rows read with a narrow select) */
  source_key?: string | null
  corrects_document_id?: string | null
  plan_id?: string | null
  order_version?: number | null
  buyer_warning?: unknown
  gov_send_date?: Date | string | null
  gov_verification_link?: string | null
  gov_link?: string | null
  gov_corrected_number?: string | null
  gov_errors?: unknown
  ksef_resend_at?: Date | string | null
  corrections_checked_at?: Date | string | null
  /* 0.3.0 */
  create_sent_at?: Date | string | null
  email_claimed_at?: Date | string | null
  reminder_at?: Date | string | null
  finals_checked_at?: Date | string | null
  converted_at?: Date | string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

/** A correction plan as stored (`fakturownia_correction`). */
export interface PlanRow {
  id: string
  order_id: string
  display_id: number | null
  document_id: string
  document_kind: string
  document_number: string | null
  demo: boolean
  status: string
  manual_reason: string | null
  revision: number
  sources: unknown
  source_key: string | null
  reasons: unknown
  reason: string | null
  positions: unknown
  notes: unknown
  currency: string | null
  delta_net: number | string | null
  delta_vat: number | string | null
  delta_gross: number | string | null
  simulated: boolean
  correction_document_id: string | null
  approved_by: string | null
  approved_at: Date | string | null
  closed_by: string | null
  closed_at: Date | string | null
  close_note: string | null
  computed_at: Date | string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

/** One e-mail of a document (`fakturownia_email`). The address is masked. */
export interface EmailRow {
  id: string
  document_id: string
  order_id: string
  demo: boolean
  kind: string
  status: string
  recipient: string | null
  cc: string | null
  with_pdf: boolean
  subject: string | null
  error: string | null
  requested_by: string | null
  created_at?: Date | string | null
}

/** One step of a document's KSeF history (`fakturownia_ksef_event`). */
export interface KsefEventRow {
  id: string
  document_id: string
  order_id: string
  demo: boolean
  source: string
  gov_status: string | null
  gov_id: string | null
  errors: unknown
  requested_by: string | null
  note: string | null
  created_at?: Date | string | null
}

/** A setting (`fakturownia_setting`). */
export interface SettingRow {
  id: string
  key: string
  value: unknown
  updated_by: string | null
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

const KINDS: readonly string[] = ["vat", "proforma", "receipt", "correction"]
const STATUSES: readonly string[] = ["pending", "issuing", "issued", "failed", "unknown", "canceled", "needs_correction"]
const EMAIL: readonly string[] = ["pending", "sending", "sent", "failed"]

function amount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function amounts(v: unknown): { quantity: number; gross: number } | null {
  if (!v || typeof v !== "object") return null
  const a = v as Record<string, unknown>
  return { quantity: Number(a.quantity) || 0, gross: Number(a.gross) || 0 }
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
      before: amounts(p.before),
      after: amounts(p.after),
    }))
}

function jsonOf(v: unknown): unknown {
  return typeof v === "string" ? safeJson(v) : v
}

function stringList(v: unknown): string[] {
  const raw = jsonOf(v)
  return Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : []
}

function buyerWarningOf(v: unknown): BuyerWarningDto | null {
  const raw = jsonOf(v)
  if (!raw || typeof raw !== "object") return null
  const w = raw as Record<string, unknown>
  if (w.code !== "invalid_nip" && w.code !== "company_without_nip" && w.code !== "nip_on_receipt") return null
  const reason = w.reason === "checksum" || w.reason === "length" || w.reason === "shape" ? w.reason : null
  return { code: w.code, reason, source: typeof w.source === "string" ? w.source : null }
}

function httpsOnly(v: string | null | undefined): string | null {
  if (!v) return null
  try {
    return new URL(v).protocol === "https:" ? v : null
  } catch {
    return null
  }
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
    buyerWarning: buyerWarningOf(r.buyer_warning),
    fromFakturowniaId: r.from_fakturownia_id ?? null,
    correctsDocumentId: r.corrects_document_id ?? null,
    paid: Boolean(r.paid),
    paidAt: iso(r.paid_at),
    govStatus: r.gov_status ?? null,
    govState: govState(r.gov_status),
    govId: r.gov_id ?? null,
    govError: r.gov_error ?? null,
    govErrors: stringList(r.gov_errors).length > 0 ? stringList(r.gov_errors) : r.gov_error ? [r.gov_error] : [],
    govSendDate: iso(r.gov_send_date),
    govVerificationLink: httpsOnly(r.gov_verification_link),
    govLink: httpsOnly(r.gov_link),
    govCorrectedNumber: r.gov_corrected_number ?? null,
    govCheckedAt: iso(r.gov_checked_at),
    ksefResendAt: iso(r.ksef_resend_at),
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
      /* Demo documents have a generated PDF (since 0.2.0); live ones are fetched by the backend. */
      pdf: Boolean(remoteId) && (status === "issued" || status === "needs_correction" || status === "canceled"),
      email: Boolean(remoteId) && (status === "issued" || status === "needs_correction"),
      ksefResend: Boolean(remoteId) && (status === "issued" || status === "needs_correction") && goesToKsef(r.kind) && canResendKsef(r.gov_status),
      ksefFiles: Boolean(remoteId) && goesToKsef(r.kind) && govState(r.gov_status) === "accepted",
    },
  }
}

const PLAN_STATUSES: readonly string[] = ["draft", "manual", "approved", "issued", "dismissed", "done", "obsolete"]
const MANUAL_REASONS: readonly string[] = ["receipt", "claim_or_exchange", "unknown_positions", "unreadable_order"]
const REASONS: readonly string[] = ["cancel", "return", "refund", "edit"]

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * A correction plan for the admin. `correction` is the outbox row of an
 * approved plan; `names` turns user ids into e-mails (who approved, who
 * dismissed).
 */
export function toPlanDto(r: PlanRow, correction: DocumentRow | null, names: Record<string, string> = {}): CorrectionPlanDto {
  const status = (PLAN_STATUSES.includes(r.status) ? r.status : "draft") as PlanStatus
  const positions = (Array.isArray(jsonOf(r.positions)) ? (jsonOf(r.positions) as Array<Record<string, unknown>>) : [])
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const delta = (p.delta && typeof p.delta === "object" ? p.delta : {}) as Record<string, unknown>
      return {
        name: String(p.name ?? ""),
        code: p.code === null || p.code === undefined ? null : String(p.code),
        tax: String(p.tax ?? ""),
        unit: String(p.unit ?? ""),
        before: amounts(p.before) ?? { quantity: 0, gross: 0 },
        after: amounts(p.after) ?? { quantity: 0, gross: 0 },
        delta: { quantity: num(delta.quantity), gross: num(delta.gross), net: num(delta.net), vat: num(delta.vat) },
      }
    })
  const sources = (Array.isArray(jsonOf(r.sources)) ? (jsonOf(r.sources) as Array<Record<string, unknown>>) : [])
    .filter((s) => s && typeof s === "object")
    .map((s) => ({ type: String(s.type ?? ""), id: String(s.id ?? ""), at: String(s.at ?? "") }))
  const notes = (Array.isArray(jsonOf(r.notes)) ? (jsonOf(r.notes) as Array<Record<string, unknown>>) : [])
    .filter((n) => n && typeof n === "object")
    .map((n) => ({ code: String(n.code ?? ""), amount: n.amount === undefined || n.amount === null ? null : num(n.amount), detail: n.detail ? String(n.detail) : null }))
  const who = (id: string | null) => (id ? names[id] ?? id : null)
  const correctionStatus = correction ? ((STATUSES.includes(correction.status) ? correction.status : "pending") as DocumentStatus) : null
  return {
    id: r.id,
    orderId: r.order_id,
    displayId: r.display_id ?? null,
    documentId: r.document_id,
    documentKind: (KINDS.includes(r.document_kind) ? r.document_kind : "vat") as DocumentKind,
    documentNumber: r.document_number ?? null,
    status,
    manualReason: (r.manual_reason && MANUAL_REASONS.includes(r.manual_reason) ? r.manual_reason : null) as ManualReason | null,
    revision: r.revision ?? 1,
    sources,
    reasons: stringList(r.reasons).filter((x) => REASONS.includes(x)) as ReasonKind[],
    reason: r.reason ?? null,
    positions,
    notes,
    currency: r.currency ?? null,
    totals: { net: num(r.delta_net), vat: num(r.delta_vat), gross: num(r.delta_gross) },
    simulated: Boolean(r.simulated),
    correction:
      correction && correctionStatus
        ? { id: correction.id, status: correctionStatus, number: correction.number ?? null, error: correction.error ?? null, errorCode: correction.error_code ?? null }
        : null,
    approvedBy: who(r.approved_by),
    approvedAt: iso(r.approved_at),
    closedBy: who(r.closed_by),
    closedAt: iso(r.closed_at),
    closeNote: r.close_note ?? null,
    computedAt: iso(r.computed_at),
    createdAt: iso(r.created_at),
    demo: Boolean(r.demo),
    actions: {
      approve: status === "draft",
      dismiss: status === "draft" || (status === "approved" && (!correctionStatus || correctionStatus === "failed" || correctionStatus === "pending")),
      done: status === "manual",
    },
  }
}

const EMAIL_KINDS: readonly string[] = ["auto", "manual", "reminder"]
const EMAIL_OUTCOMES: readonly string[] = ["sent", "failed", "refused"]

export function toEmailDto(r: EmailRow, doc: Pick<DocumentRow, "number" | "display_id"> | null = null, names: Record<string, string> = {}): EmailDto {
  return {
    id: r.id,
    documentId: r.document_id,
    orderId: r.order_id,
    kind: (EMAIL_KINDS.includes(r.kind) ? r.kind : "manual") as EmailDto["kind"],
    status: (EMAIL_OUTCOMES.includes(r.status) ? r.status : "failed") as EmailDto["status"],
    recipient: r.recipient ?? null,
    cc: r.cc ?? null,
    withPdf: Boolean(r.with_pdf),
    subject: r.subject ?? null,
    error: r.error ?? null,
    requestedBy: r.requested_by ? names[r.requested_by] ?? r.requested_by : null,
    createdAt: iso(r.created_at),
    demo: Boolean(r.demo),
    documentNumber: doc?.number ?? null,
    displayId: doc?.display_id ?? null,
  }
}

const KSEF_SOURCES: readonly string[] = ["issue", "refresh", "resend", "demo"]

export function toKsefEventDto(r: KsefEventRow, names: Record<string, string> = {}): KsefEventDto {
  return {
    id: r.id,
    source: (KSEF_SOURCES.includes(r.source) ? r.source : "refresh") as KsefEventDto["source"],
    govStatus: r.gov_status ?? null,
    govState: govState(r.gov_status),
    govId: r.gov_id ?? null,
    errors: stringList(r.errors),
    requestedBy: r.requested_by ? names[r.requested_by] ?? r.requested_by : null,
    note: r.note ?? null,
    createdAt: iso(r.created_at),
  }
}

/** A writer state for the admin, with the name of who flipped it. */
export function toWriterDto(w: { key: WriterDto["key"]; allowed: boolean; on: boolean; armed: boolean; updatedBy: string | null; updatedAt: string | null }, names: Record<string, string> = {}): WriterDto {
  return { ...w, updatedBy: w.updatedBy ? names[w.updatedBy] ?? w.updatedBy : null }
}

/**
 * A document as the logged-in customer sees it in the storefront: what is
 * printed on it, and the route of its PDF. No error, no internal state.
 */
export function toStoreDocumentDto(r: DocumentRow, correctedNumber: string | null = null): StoreDocumentDto {
  return {
    id: r.id,
    kind: (KINDS.includes(r.kind) ? r.kind : "vat") as DocumentKind,
    number: r.number ?? null,
    issueDate: r.issue_date ?? null,
    totalGross: amount(r.total_gross),
    currency: r.currency ?? null,
    paid: Boolean(r.paid),
    ksefNumber: govState(r.gov_status) === "accepted" ? r.gov_id ?? null : null,
    corrects: r.kind === "correction" ? correctedNumber : null,
    pdfUrl: `/store/fakturownia/documents/${encodeURIComponent(r.id)}/pdf`,
  }
}

/** Whether a customer may see a document: issued in Fakturownia (corrections included). */
export function isCustomerVisible(r: Pick<DocumentRow, "status" | "fakturownia_id">): boolean {
  return (r.status === "issued" || r.status === "needs_correction") && Boolean(r.fakturownia_id && /^\d+$/.test(r.fakturownia_id))
}

export function toRunDto(r: RunRow): RunDto {
  const kind = r.kind === "payments" || r.kind === "statuses" || r.kind === "corrections" ? r.kind : "issue"
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
