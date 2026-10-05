/**
 * THE ATOMIC OPERATIONS OF THE WRITERS, in SQL. Statements only: the database
 * connection is injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory store.
 *
 * WHY RAW SQL: the generated service updates "by selector" by listing the
 * rows first and updating them by id afterwards, so two processes can both
 * see a pending row and both "claim" it. A claim must be ONE statement:
 *
 *   update ... set state = 'applying' ... where id = ? and state in (...) returning *
 *
 * Postgres lets exactly one of two concurrent statements win. The same holds
 * for the insert of a publication (`on conflict do nothing` against the
 * unique index on the variant), for writing the result (only the claim's
 * owner, by its token) and for the planner's changes (only from given states).
 * Plain reads and the planner's other writes go through the generated service.
 */

export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export const PLAN_TABLE = "olx_plan_item"
export const PUBLICATION_TABLE = "olx_publication"

export const PLAN_PATCHABLE: readonly string[] = [
  "action",
  "reason",
  "from_value",
  "to_value",
  "approved_value",
  "state",
  "attempts",
  "last_error",
  "note",
  "planned_at",
  "last_attempt_at",
  "done_at",
  "paused_at",
  "unknown_since",
  "title",
  "variant_id",
  "product_id",
  "sku",
]

export const PUBLICATION_PATCHABLE: readonly string[] = [
  "state",
  "attempts",
  "last_error",
  "note",
  "title",
  "olx_category_id",
  "payload",
  "missing",
  "warnings",
  "planned_at",
  "last_attempt_at",
  "unknown_since",
  "olx_id",
  "olx_url",
  "olx_status",
  "adopted",
  "published_at",
  "product_id",
  "sku",
]

const JSON_COLUMNS: ReadonlySet<string> = new Set(["from_value", "to_value", "approved_value", "payload", "missing", "warnings"])

export function setClause(patch: Record<string, unknown>, allowed: readonly string[]): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  for (const column of allowed) {
    if (!(column in patch) || patch[column] === undefined) continue
    const v = patch[column]
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

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

function placeholders(list: readonly unknown[]): string {
  return list.map(() => "?").join(", ")
}

/* ------------------------------------------------------------------ */
/* Contracts the flows depend on (the memory store in the tests too)   */
/* ------------------------------------------------------------------ */

export interface ClaimArgs {
  now: Date
  leaseUntil: Date
  token: string
}

export interface PlanItemStore {
  /** pending or failed becomes applying, for exactly one caller. */
  claim(id: string, args: ClaimArgs): Promise<Record<string, any> | null>
  /** Writes the result, only for the owner of the claim. */
  finish(id: string, token: string, patch: Record<string, unknown>): Promise<boolean>
  /** Moves a row only from one of the given states. */
  transition(id: string, from: readonly string[], patch: Record<string, unknown>): Promise<Record<string, any> | null>
  /** Applying rows whose lease ran out become unknown (the process died mid-request). */
  expireLeases(now: Date, demo: boolean): Promise<number>
}

export interface PublicationStore extends PlanItemStore {
  /** Inserts a row; null when the variant already has one (the insert is ignored). */
  insertIgnore(row: NewPublication): Promise<Record<string, any> | null>
  /** Deletes rows that never went to the network, and only those. */
  deleteUnsent(ids: readonly string[]): Promise<number>
}

export interface NewPublication {
  variant_id: string
  product_id: string
  sku: string
  title: string
  olx_category_id: number | null
  state: "planned" | "blocked"
  payload: unknown
  missing: unknown
  warnings: unknown
  demo: boolean
  planned_at: Date
}

/** States a publication may be claimed from, and the states that never reached OLX. */
export const PUBLICATION_CLAIMABLE: readonly string[] = ["planned", "failed"]
export const PUBLICATION_UNSENT: readonly string[] = ["planned", "blocked", "failed", "quarantined"]
export const PLAN_CLAIMABLE: readonly string[] = ["pending", "failed"]

function claimSql(table: string, from: readonly string[], inFlight: string): string {
  return `update "${table}"
         set "state" = '${inFlight}', "claim_token" = ?, "lease_until" = ?, "last_attempt_at" = ?, "updated_at" = now()
         where "id" = ? and "state" in (${from.map((s) => `'${s}'`).join(", ")}) and "deleted_at" is null
         returning *`
}

function storeFor(sql: SqlRunner, table: string, allowed: readonly string[], claimable: readonly string[], inFlight: string): PlanItemStore {
  return {
    async claim(id, args) {
      const result = await sql.raw(claimSql(table, claimable, inFlight), [args.token, args.leaseUntil, args.now, id])
      return rowsOf<Record<string, any>>(result)[0] ?? null
    },
    async finish(id, token, patch) {
      const set = setClause(patch, allowed)
      const result = await sql.raw(
        `update "${table}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "state" = '${inFlight}' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },
    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = setClause(patch, allowed)
      const result = await sql.raw(
        `update "${table}" set ${set.sql}
         where "id" = ? and "state" in (${placeholders(from)}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<Record<string, any>>(result)[0] ?? null
    },
    async expireLeases(now, demo) {
      const result = await sql.raw(
        `update "${table}"
         set "state" = 'unknown', "claim_token" = null, "lease_until" = null, "unknown_since" = ?,
             "last_error" = ?, "updated_at" = now()
         where "state" = '${inFlight}' and "lease_until" < ? and "demo" = ? and "deleted_at" is null
         returning "id"`,
        [now, "The process stopped while the request was on its way. OLX is looked up before anything is sent again.", now, demo],
      )
      return rowsOf(result).length
    },
  }
}

export function createPlanItemStore(sql: SqlRunner): PlanItemStore {
  return storeFor(sql, PLAN_TABLE, PLAN_PATCHABLE, PLAN_CLAIMABLE, "applying")
}

export function createPublicationStore(sql: SqlRunner, newId: () => string): PublicationStore {
  const base = storeFor(sql, PUBLICATION_TABLE, PUBLICATION_PATCHABLE, PUBLICATION_CLAIMABLE, "publishing")
  return {
    ...base,
    async insertIgnore(row) {
      const result = await sql.raw(
        `insert into "${PUBLICATION_TABLE}" ("id", "variant_id", "product_id", "sku", "title", "olx_category_id", "state",
           "payload", "missing", "warnings", "demo", "attempts", "adopted", "planned_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, 0, false, ?, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId(),
          row.variant_id,
          row.product_id,
          row.sku,
          row.title,
          row.olx_category_id,
          row.state,
          row.payload === null || row.payload === undefined ? null : JSON.stringify(row.payload),
          JSON.stringify(row.missing ?? []),
          JSON.stringify(row.warnings ?? []),
          row.demo,
          row.planned_at,
        ],
      )
      return rowsOf<Record<string, any>>(result)[0] ?? null
    },
    async deleteUnsent(ids) {
      if (ids.length === 0) return 0
      const result = await sql.raw(
        `delete from "${PUBLICATION_TABLE}"
         where "id" in (${placeholders(ids)}) and "state" in (${placeholders(PUBLICATION_UNSENT)})
         returning "id"`,
        [...ids, ...PUBLICATION_UNSENT],
      )
      return rowsOf(result).length
    },
  }
}
