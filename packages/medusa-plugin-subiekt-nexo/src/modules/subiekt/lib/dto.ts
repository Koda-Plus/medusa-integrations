/**
 * Database rows as the generated service returns them, and their admin DTOs.
 * Dates leave as ISO strings; secrets never get here (no table stores one).
 */

import type { BuyerResult, DocumentDto, RunDto, RunKind, RunStatus, RunTrigger, TaskDto, TaskKind, TaskStatus } from "./contract"

export interface ConnectionRow {
  id: string
  reachable: boolean
  health: Record<string, unknown> | null
  checked_at: Date | string | null
  last_error: string | null
  last_error_at: Date | string | null
  consecutive_failures: number
  events_cursor: string | null
  events_read_at: Date | string | null
  /** Since 0.2.0: the last health check measured. */
  latency_ms?: number | null
  clock_skew_ms?: number | null
  /** Since 0.2.0: signature verdict, webhook bookkeeping. */
  diagnostics?: Record<string, unknown> | null
}

export interface TaskRow {
  id: string
  kind: string
  order_id: string
  display_id: number | null
  reference: string | null
  status: string
  trigger: string
  attempts: number
  next_attempt_at: Date | string | null
  started_at: Date | string | null
  succeeded_at: Date | string | null
  last_error: string | null
  last_error_code: string | null
  result: Record<string, unknown> | null
  /** Since 0.2.0: input frozen when the task was queued, for example `{ kind: "fs" }`. */
  detail?: Record<string, unknown> | null
  demo?: boolean
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export interface DocumentRow {
  id: string
  order_id: string | null
  display_id: number | null
  kind: string
  number: string
  subiekt_id: string | null
  status: string
  issued_at: Date | string | null
  source: string
  warehouse: string | null
  related: Array<{ kind: string; number: string }> | null
  event_id: string | null
  applied_at: Date | string | null
  /** Since 0.2.0. */
  ksef_number?: string | null
  demo: boolean
  created_at?: Date | string | null
}

export interface RunRow {
  id: string
  kind: string
  trigger: string
  status: string
  dry_run: boolean
  message: string | null
  stats: Record<string, unknown> | null
  started_at: Date | string | null
  finished_at: Date | string | null
  duration_ms: number
  demo?: boolean
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []
}

function buyerOf(value: unknown): BuyerResult | null {
  if (!value || typeof value !== "object") return null
  const b = value as Record<string, unknown>
  if (b.source !== "existing" && b.source !== "created" && b.source !== "retail") return null
  return {
    source: b.source,
    nip: typeof b.nip === "string" ? b.nip : null,
    symbol: typeof b.symbol === "string" ? b.symbol : null,
    name: typeof b.name === "string" ? b.name : null,
  }
}

export function toTaskDto(r: TaskRow): TaskDto {
  const number = r.result && typeof r.result.number === "string" ? r.result.number : null
  const kind = r.detail && typeof r.detail.kind === "string" ? r.detail.kind : r.result && typeof r.result.kind === "string" ? String(r.result.kind).toLowerCase() : null
  return {
    id: r.id,
    kind: r.kind as TaskKind,
    orderId: r.order_id,
    displayId: r.display_id ?? null,
    status: r.status as TaskStatus,
    trigger: r.trigger,
    attempts: r.attempts ?? 0,
    nextAttemptAt: iso(r.next_attempt_at),
    lastError: r.last_error ?? null,
    lastErrorCode: r.last_error_code ?? null,
    reference: r.reference ?? null,
    documentNumber: number,
    manualAction: Boolean(r.result && r.result.manual_action_required === true),
    warnings: strings(r.result?.warnings),
    buyer: buyerOf(r.result?.buyer),
    documentKind: r.kind === "order.document" ? kind : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    succeededAt: iso(r.succeeded_at),
  }
}

export function toDocumentDto(r: DocumentRow): DocumentDto {
  return {
    id: r.id,
    orderId: r.order_id ?? null,
    displayId: r.display_id ?? null,
    kind: r.kind,
    number: r.number,
    status: r.status,
    issuedAt: iso(r.issued_at),
    source: r.source,
    warehouse: r.warehouse ?? null,
    ksefNumber: r.ksef_number ?? null,
    related: Array.isArray(r.related) ? r.related : [],
    createdAt: iso(r.created_at),
  }
}

export function toRunDto(r: RunRow): RunDto {
  return {
    id: r.id,
    kind: r.kind as RunKind,
    trigger: r.trigger as RunTrigger,
    status: r.status as RunStatus,
    dryRun: Boolean(r.dry_run),
    message: r.message ?? null,
    stats: r.stats ?? null,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    durationMs: r.duration_ms ?? 0,
  }
}
