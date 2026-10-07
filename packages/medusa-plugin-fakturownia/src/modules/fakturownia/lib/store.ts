/**
 * THE ATOMIC OPERATIONS OF THE OUTBOX, in SQL. Types and SQL text only: the
 * database connection is injected (`SqlRunner`, the Knex instance Medusa
 * registers as `__pg_connection__`), so the unit tests check the statements
 * without a database and drive the flows with an in-memory store.
 *
 * WHY RAW SQL: the generated service updates "by selector" by listing the
 * rows first and updating them by id afterwards. Two processes can both list
 * a pending row and both "claim" it. A claim must be ONE statement:
 *
 *   update ... set status = 'issuing' ... where id = ? and status = 'pending'
 *   ... returning *
 *
 * Postgres lets exactly one of two concurrent statements see `pending`; the
 * other updates nothing and walks away. The same holds for the insert
 * (`on conflict do nothing` against the unique indexes), for writing the
 * result (only the claim's owner, by its token) and for the state changes a
 * person or an event makes (only from the states it may come from).
 *
 * Reads and plain updates go through the generated module service.
 */

import type { DocumentRow } from "./dto"

export type DocumentPatch = Partial<
  Pick<
    DocumentRow,
    | "display_id"
    | "status"
    | "fakturownia_id"
    | "number"
    | "oid"
    | "issue_date"
    | "currency"
    | "total_gross"
    | "positions"
    | "buyer_type"
    | "from_fakturownia_id"
    | "paid"
    | "paid_at"
    | "pay_requested_at"
    | "gov_status"
    | "gov_id"
    | "gov_error"
    | "gov_checked_at"
    | "error"
    | "error_code"
    | "attempts"
    | "next_attempt_at"
    | "claimed_at"
    | "issued_at"
    | "cancel_requested_at"
    | "email_status"
    | "emailed_at"
    | "email_error"
    | "order_version"
    | "buyer_warning"
    | "gov_send_date"
    | "gov_verification_link"
    | "gov_link"
    | "gov_corrected_number"
    | "gov_errors"
    | "ksef_resend_at"
    | "corrections_checked_at"
    | "create_sent_at"
    | "email_claimed_at"
    | "reminder_at"
    | "finals_checked_at"
    | "converted_at"
  >
>

export interface NewDocument {
  order_id: string
  display_id: number | null
  kind: string
  demo: boolean
  next_attempt_at: Date | null
  pay_requested_at?: Date | null
  /** Corrections: the business key, the corrected row and the approved plan. */
  source_key?: string | null
  corrects_document_id?: string | null
  plan_id?: string | null
}

export interface DocumentStore {
  /** Inserts a pending row; `null` when the unique indexes already hold one (the insert is ignored). */
  insertIgnore(doc: NewDocument): Promise<DocumentRow | null>
  /** pending and due becomes issuing, for exactly one caller; `null` for everybody else. */
  claim(id: string, args: { now: Date; leaseUntil: Date; token: string }): Promise<DocumentRow | null>
  /** Writes the result of an attempt, only for the owner of the claim. */
  finish(id: string, token: string, patch: DocumentPatch): Promise<boolean>
  /** Moves a row only from one of the given states. `null` when it was in none of them. */
  transition(id: string, from: readonly string[], patch: DocumentPatch): Promise<DocumentRow | null>
  /** Issuing rows whose lease ran out become unknown (the process died mid-request). */
  expireLeases(now: Date, demo: boolean): Promise<number>
  /**
   * The claim's owner proves the claim is still its own and extends the
   * lease, writing `patch` and `create_sent_at` in the same statement. False
   * when another process took the row over (the lease ran out): the caller
   * must stop without sending anything.
   */
  renew(id: string, token: string, args: { leaseUntil: Date; patch?: DocumentPatch; createSentAt?: Date }): Promise<boolean>
  /** A pending automatic e-mail becomes `sending` for exactly one caller; `null` for everybody else. */
  claimEmail(id: string, now: Date): Promise<DocumentRow | null>
  /** Moves the e-mail state only from one of the given e-mail states. */
  transitionEmail(id: string, from: readonly string[], patch: DocumentPatch): Promise<DocumentRow | null>
  /**
   * Takes a rate-limited action of a row (`ksef_resend_at`, `reminder_at`):
   * the stamp is set to `now` only when it is empty or older than the
   * interval, for exactly one caller. `null`: someone did it less than the
   * interval ago (or just now, in another tab).
   */
  claimStamp(id: string, column: StampColumn, now: Date, minIntervalMs: number): Promise<DocumentRow | null>
  /** Gives a stamp back after the action failed, only when it is still the caller's. */
  releaseStamp(id: string, column: StampColumn, taken: Date): Promise<void>
}

/** Columns `claimStamp` may take. Only these names ever reach the SQL text. */
export type StampColumn = "ksef_resend_at" | "reminder_at"
export const STAMP_COLUMNS: readonly StampColumn[] = ["ksef_resend_at", "reminder_at"]

function stampColumn(column: string): StampColumn {
  if (!(STAMP_COLUMNS as readonly string[]).includes(column)) throw new Error(`not a stamp column: ${column}`)
  return column as StampColumn
}

/** The smallest piece of Knex the store needs. */
export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export const TABLE = "fakturownia_document"

/** Columns a patch may set. Only these names ever reach the SQL text. */
export const PATCHABLE_COLUMNS: readonly string[] = [
  "display_id",
  "status",
  "fakturownia_id",
  "number",
  "oid",
  "issue_date",
  "currency",
  "total_gross",
  "positions",
  "buyer_type",
  "from_fakturownia_id",
  "paid",
  "paid_at",
  "pay_requested_at",
  "gov_status",
  "gov_id",
  "gov_error",
  "gov_checked_at",
  "error",
  "error_code",
  "attempts",
  "next_attempt_at",
  "claimed_at",
  "issued_at",
  "cancel_requested_at",
  "email_status",
  "emailed_at",
  "email_error",
  "order_version",
  "buyer_warning",
  "gov_send_date",
  "gov_verification_link",
  "gov_link",
  "gov_corrected_number",
  "gov_errors",
  "ksef_resend_at",
  "corrections_checked_at",
  "create_sent_at",
  "email_claimed_at",
  "reminder_at",
  "finals_checked_at",
  "converted_at",
]

const JSON_COLUMNS: ReadonlySet<string> = new Set(["positions", "buyer_warning", "gov_errors"])

export function setClause(patch: DocumentPatch): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  const values = patch as Record<string, unknown>
  for (const column of PATCHABLE_COLUMNS) {
    if (!(column in values) || values[column] === undefined) continue
    const v = values[column]
    if (JSON_COLUMNS.has(column)) {
      parts.push(`"${column}" = ?::jsonb`)
      bindings.push(v === null ? null : JSON.stringify(v))
    } else {
      parts.push(`"${column}" = ?`)
      bindings.push(v)
    }
  }
  parts.push(`"updated_at" = now()`)
  return { sql: parts.join(", "), bindings }
}

function rowsOf(result: unknown): DocumentRow[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as DocumentRow[]) : []
}

export function createSqlStore(deps: { sql: SqlRunner; newId: () => string }): DocumentStore {
  const { sql, newId } = deps
  return {
    async insertIgnore(doc) {
      const result = await sql.raw(
        `insert into "${TABLE}" ("id", "order_id", "display_id", "kind", "status", "demo", "attempts", "next_attempt_at", "pay_requested_at", "paid",
                                  "source_key", "corrects_document_id", "plan_id", "created_at", "updated_at")
         values (?, ?, ?, ?, 'pending', ?, 0, ?, ?, false, ?, ?, ?, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId(),
          doc.order_id,
          doc.display_id,
          doc.kind,
          doc.demo,
          doc.next_attempt_at,
          doc.pay_requested_at ?? null,
          doc.source_key ?? null,
          doc.corrects_document_id ?? null,
          doc.plan_id ?? null,
        ],
      )
      return rowsOf(result)[0] ?? null
    },

    async claim(id, args) {
      const result = await sql.raw(
        `update "${TABLE}"
         set "status" = 'issuing', "claim_token" = ?, "claimed_at" = ?, "lease_until" = ?, "create_sent_at" = null, "attempts" = "attempts" + 1, "updated_at" = now()
         where "id" = ? and "status" = 'pending' and "deleted_at" is null
           and ("next_attempt_at" is null or "next_attempt_at" <= ?)
         returning *`,
        [args.token, args.now, args.leaseUntil, id, args.now],
      )
      return rowsOf(result)[0] ?? null
    },

    async finish(id, token, patch) {
      const set = setClause(patch)
      const result = await sql.raw(
        `update "${TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "status" = 'issuing' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },

    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = setClause(patch)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${TABLE}" set ${set.sql}
         where "id" = ? and "status" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf(result)[0] ?? null
    },

    async expireLeases(now, demo) {
      const result = await sql.raw(
        `update "${TABLE}"
         set "status" = 'unknown', "claim_token" = null, "lease_until" = null, "error_code" = 'lease_expired',
             "error" = ?, "next_attempt_at" = ?, "updated_at" = now()
         where "status" = 'issuing' and "lease_until" < ? and "demo" = ? and "deleted_at" is null
         returning "id"`,
        [
          "The attempt did not finish within its claim (the process stopped, or Fakturownia answered too slowly). The document is looked up in Fakturownia before anything is sent again.",
          now,
          now,
          demo,
        ],
      )
      return rowsOf(result).length
    },

    async renew(id, token, args) {
      const set = setClause({ ...(args.patch ?? {}), ...(args.createSentAt ? { create_sent_at: args.createSentAt } : {}) })
      const result = await sql.raw(
        `update "${TABLE}" set ${set.sql}, "lease_until" = ?
         where "id" = ? and "status" = 'issuing' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, args.leaseUntil, id, token],
      )
      return rowsOf(result).length > 0
    },

    async claimEmail(id, now) {
      const result = await sql.raw(
        `update "${TABLE}"
         set "email_status" = 'sending', "email_claimed_at" = ?, "updated_at" = now()
         where "id" = ? and "email_status" = 'pending' and "status" = 'issued' and "deleted_at" is null
         returning *`,
        [now, id],
      )
      return rowsOf(result)[0] ?? null
    },

    async transitionEmail(id, from, patch) {
      if (from.length === 0) return null
      const set = setClause(patch)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${TABLE}" set ${set.sql}
         where "id" = ? and "email_status" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf(result)[0] ?? null
    },

    async claimStamp(id, column, now, minIntervalMs) {
      const c = stampColumn(column)
      const result = await sql.raw(
        `update "${TABLE}" set "${c}" = ?, "updated_at" = now()
         where "id" = ? and "deleted_at" is null and ("${c}" is null or "${c}" <= ?)
         returning *`,
        [now, id, new Date(now.getTime() - minIntervalMs)],
      )
      return rowsOf(result)[0] ?? null
    },

    async releaseStamp(id, column, taken) {
      const c = stampColumn(column)
      await sql.raw(`update "${TABLE}" set "${c}" = null, "updated_at" = now() where "id" = ? and "${c}" = ? and "deleted_at" is null`, [id, taken])
    },
  }
}
