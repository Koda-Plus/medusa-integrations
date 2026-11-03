/**
 * TWO QUIET PROBLEMS OF A KSeF ACCOUNT, as pure rules (0.4.0). Imports the
 * KSeF statuses and the constants only.
 *
 *   ksef_stuck   A VAT invoice or correction still has no KSeF number
 *                (`gov_id`) `ksefStuckAfterDays` days after issue. The admin
 *                says exactly where it is: never sent to KSeF, on its way,
 *                offline, or a KSeF error with its messages. Such documents
 *                are read past the 14 day status window, until 60 days after
 *                issue, so a number that comes late clears the item by itself.
 *   not_emailed  The document has its KSeF number, and `notEmailedAfterHours`
 *                later neither Fakturownia (its own `email_status` / `sent_time`:
 *                an account may e-mail every document once KSeF numbers it)
 *                nor the plugin (`emailed_at`) sent it to the buyer. The fix
 *                is "Send by e-mail".
 *
 * NO NOISE ON ACCOUNTS THAT WORK DIFFERENTLY. `ksef_stuck` speaks only on an
 * account where KSeF numbered a document of this mode before (`ksefActive`),
 * and a document never sent to KSeF counts only for a company buyer (a
 * "companies only" sending mode leaves consumer invoices outside KSeF on
 * purpose). `not_emailed` speaks only when the buyer is meant to get the
 * document by e-mail: `sendByEmail` is on, or Fakturownia was seen e-mailing a
 * document of this mode (`emailsExpected`). Both look back 60 days at most,
 * so documents from before KSeF never flood the list.
 *
 * The same rules exist twice on purpose: in memory (`watchOf`, for the
 * document DTO and the order line) and as service filters (`watchFilters`,
 * for the "Needs attention" list and its counter), and the tests hold them
 * together.
 */

import type { DocumentWatchDto, KsefWaitState } from "./contract"
import { EMAIL_PROBE_DAYS, KSEF_LATE_WINDOW_DAYS, LATE_RECHECK_MS, STATUS_WINDOW_DAYS } from "./constants"
import { baseGovStatus, goesToKsef, govState } from "./status"

const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000

export interface WatchContext {
  now: Date
  /** 0: off. */
  ksefStuckAfterDays: number
  /** 0: off. */
  notEmailedAfterHours: number
  /** KSeF numbered a document of this mode before. */
  ksefActive: boolean
  /** `sendByEmail` is on, or Fakturownia was seen e-mailing a document of this mode. */
  emailsExpected: boolean
}

export interface WatchRow {
  kind: string
  status: string
  fakturownia_id: string | null
  gov_status: string | null
  gov_id: string | null
  gov_error?: string | null
  gov_errors?: unknown
  buyer_type: string | null
  issued_at: Date | string | null
  error_code: string | null
  emailed_at: Date | string | null
  ksef_number_at?: Date | string | null
  remote_email_status?: string | null
  remote_sent_at?: Date | string | null
  remote_email_checked_at?: Date | string | null
}

/** `gov_status` values after which a document waits for no number: accepted (it has one) or outside KSeF. */
const NOT_WAITING: readonly string[] = ["ok", "demo_ok", "not_applicable", "demo_not_applicable"]
const ISSUED: readonly string[] = ["issued", "needs_correction"]
const KSEF_KINDS: readonly string[] = ["vat", "correction"]

function time(v: Date | string | null | undefined): number | null {
  if (!v) return null
  const t = (v instanceof Date ? v : new Date(v)).getTime()
  return Number.isFinite(t) ? t : null
}

function iso(t: number): string {
  return new Date(t).toISOString()
}

/** Whether Fakturownia says it e-mailed the document: a `sent_time`, or `email_status` "sent". */
export function remoteEmailed(status: string | null | undefined, sentAt: Date | string | null | undefined): boolean {
  return Boolean(time(sentAt)) || String(status ?? "").trim().toLowerCase() === "sent"
}

/** Where a document without a KSeF number is, in the words of the admin. */
export function ksefWaitState(govStatus: string | null | undefined): KsefWaitState {
  const s = govState(govStatus)
  if (s === "processing") return "processing"
  if (s === "offline") return "offline"
  if (s === "problem") return "error"
  return "not_sent"
}

/**
 * A VAT invoice or correction in Fakturownia that should get a KSeF number
 * and has none: not accepted, not outside KSeF, still in Fakturownia, and,
 * when it was never sent, issued for a company.
 */
export function expectsKsefNumber(row: WatchRow): boolean {
  if (!ISSUED.includes(row.status) || !goesToKsef(row.kind) || !row.fakturownia_id || row.gov_id) return false
  if (row.error_code === "remote_missing") return false
  if (row.gov_status && NOT_WAITING.includes(row.gov_status)) return false
  if (govState(row.gov_status) === "none") return row.buyer_type === "company"
  return true
}

function errorsOf(row: WatchRow): string[] {
  let raw = row.gov_errors as unknown
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = null
    }
  }
  const list = Array.isArray(raw) ? raw.map((e) => String(e)).filter(Boolean) : []
  return list.length > 0 ? list : row.gov_error ? [row.gov_error] : []
}

/** `ksef_stuck` of one row, or null. */
export function stuckWithoutNumber(row: WatchRow, ctx: WatchContext): Extract<DocumentWatchDto, { kind: "ksef_stuck" }> | null {
  if (!ctx.ksefActive || ctx.ksefStuckAfterDays <= 0 || !expectsKsefNumber(row)) return null
  const issued = time(row.issued_at)
  const now = ctx.now.getTime()
  if (issued === null || issued > now - ctx.ksefStuckAfterDays * DAY || issued < now - KSEF_LATE_WINDOW_DAYS * DAY) return null
  const state = ksefWaitState(row.gov_status)
  return {
    kind: "ksef_stuck",
    state,
    govStatus: row.gov_status ? baseGovStatus(row.gov_status) : null,
    errors: state === "error" ? errorsOf(row) : [],
    since: iso(issued),
    days: Math.floor((now - issued) / DAY),
  }
}

/** `not_emailed` of one row, or null. Needs one read of Fakturownia's e-mail fields after the number. */
export function notEmailed(row: WatchRow, ctx: WatchContext): Extract<DocumentWatchDto, { kind: "not_emailed" }> | null {
  if (!ctx.emailsExpected || ctx.notEmailedAfterHours <= 0) return null
  if (!ISSUED.includes(row.status) || !goesToKsef(row.kind) || !row.gov_id || time(row.emailed_at) !== null) return null
  const numbered = time(row.ksef_number_at)
  const now = ctx.now.getTime()
  if (numbered === null || numbered > now - ctx.notEmailedAfterHours * HOUR || numbered < now - KSEF_LATE_WINDOW_DAYS * DAY) return null
  if (time(row.remote_email_checked_at) === null || remoteEmailed(row.remote_email_status, row.remote_sent_at)) return null
  return { kind: "not_emailed", since: iso(numbered), hours: Math.floor((now - numbered) / HOUR) }
}

/** Why an issued document waits for a person although nothing failed; null when it does not. */
export function watchOf(row: WatchRow, ctx: WatchContext | null | undefined): DocumentWatchDto | null {
  if (!ctx) return null
  return stuckWithoutNumber(row, ctx) ?? notEmailed(row, ctx)
}

/* ------------------------------------------------------------------ */
/* The same rules as service filters                                   */
/* ------------------------------------------------------------------ */

const notRemoteMissing = { $or: [{ error_code: null }, { error_code: { $ne: "remote_missing" } }] }

/** `expectsKsefNumber` as a service filter, without the time window. */
function expectsNumberFilter(): Record<string, unknown> {
  return {
    kind: [...KSEF_KINDS],
    status: [...ISSUED],
    fakturownia_id: { $ne: null },
    gov_id: null,
    $and: [notRemoteMissing, { $or: [{ gov_status: null }, { gov_status: { $nin: [...NOT_WAITING] } }] }, { $or: [{ buyer_type: "company" }, { gov_status: { $ne: null } }] }],
  }
}

/** The alternatives `ksef_stuck` and `not_emailed` add to "Needs attention" (empty when both are off). */
export function watchFilters(ctx: WatchContext): Array<Record<string, unknown>> {
  const now = ctx.now.getTime()
  const out: Array<Record<string, unknown>> = []
  if (ctx.ksefActive && ctx.ksefStuckAfterDays > 0) {
    out.push({ ...expectsNumberFilter(), issued_at: { $lte: new Date(now - ctx.ksefStuckAfterDays * DAY), $gte: new Date(now - KSEF_LATE_WINDOW_DAYS * DAY) } })
  }
  if (ctx.emailsExpected && ctx.notEmailedAfterHours > 0) {
    out.push({
      kind: [...KSEF_KINDS],
      status: [...ISSUED],
      gov_id: { $ne: null },
      emailed_at: null,
      ksef_number_at: { $lte: new Date(now - ctx.notEmailedAfterHours * HOUR), $gte: new Date(now - KSEF_LATE_WINDOW_DAYS * DAY) },
      remote_email_checked_at: { $ne: null },
      remote_sent_at: null,
      $and: [{ $or: [{ remote_email_status: null }, { remote_email_status: { $ne: "sent" } }] }],
    })
  }
  return out
}

/**
 * The documents the status pass reads on top of its 14 day window (the
 * "late" ones), at most once an hour each, the least recently read first:
 *
 *   still without a KSeF number, issued 14 to 60 days ago, on an account
 *   where KSeF numbers documents;
 *   with a number the buyer may not have yet: never e-mailed by the plugin,
 *   not seen e-mailed by Fakturownia, numbered within 60 days (2 days while
 *   no document of the account was ever seen e-mailed by Fakturownia: enough
 *   to find out whether it does).
 */
export function lateReadFilters(demo: boolean, ctx: WatchContext): Array<Record<string, unknown>> {
  const now = ctx.now.getTime()
  const readBefore = new Date(now - LATE_RECHECK_MS)
  const due = { $or: [{ gov_checked_at: null }, { gov_checked_at: { $lte: readBefore } }] }
  const out: Array<Record<string, unknown>> = []
  if (ctx.ksefActive && ctx.ksefStuckAfterDays > 0) {
    const base = expectsNumberFilter()
    out.push({
      ...base,
      demo,
      issued_at: { $lt: new Date(now - STATUS_WINDOW_DAYS * DAY), $gte: new Date(now - KSEF_LATE_WINDOW_DAYS * DAY) },
      $and: [...(base.$and as unknown[]), due],
    })
  }
  if (ctx.notEmailedAfterHours > 0) {
    const days = ctx.emailsExpected ? KSEF_LATE_WINDOW_DAYS : EMAIL_PROBE_DAYS
    out.push({
      demo,
      kind: [...KSEF_KINDS],
      status: [...ISSUED],
      fakturownia_id: { $ne: null },
      gov_id: { $ne: null },
      emailed_at: null,
      remote_sent_at: null,
      ksef_number_at: { $gte: new Date(now - days * DAY) },
      $and: [notRemoteMissing, { $or: [{ remote_email_status: null }, { remote_email_status: { $ne: "sent" } }] }, due],
    })
  }
  return out
}

