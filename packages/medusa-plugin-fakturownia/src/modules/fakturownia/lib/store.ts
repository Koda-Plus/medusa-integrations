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
  >
>

export interface NewDocument {
  order_id: string
  display_id: number | null
  kind: string
  demo: boolean
  next_attempt_at: Date | null
  pay_requested_at?: Date | null
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
]

const JSON_COLUMNS: ReadonlySet<string> = new Set(["positions"])

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
        `insert into "${TABLE}" ("id", "order_id", "display_id", "kind", "status", "demo", "attempts", "next_attempt_at", "pay_requested_at", "paid", "created_at", "updated_at")
         values (?, ?, ?, ?, 'pending', ?, 0, ?, ?, false, now(), now())
         on conflict do nothing
         returning *`,
        [newId(), doc.order_id, doc.display_id, doc.kind, doc.demo, doc.next_attempt_at, doc.pay_requested_at ?? null],
      )
      return rowsOf(result)[0] ?? null
    },

    async claim(id, args) {
      const result = await sql.raw(
        `update "${TABLE}"
         set "status" = 'issuing', "claim_token" = ?, "claimed_at" = ?, "lease_until" = ?, "attempts" = "attempts" + 1, "updated_at" = now()
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
          "The process stopped while the document was being issued. It is looked up in Fakturownia before anything is sent again.",
          now,
          now,
          demo,
        ],
      )
      return rowsOf(result).length
    },
  }
}
