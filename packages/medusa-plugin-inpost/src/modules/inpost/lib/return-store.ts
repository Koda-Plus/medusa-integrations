/**
 * THE ATOMIC OPERATIONS OF RETURNS, in SQL, like `store.ts` for shipments:
 * types and SQL text only, the connection injected, an in-memory twin with
 * the same rules in test/helpers.ts.
 *
 *   insertIgnore  one row per (order, Medusa return, mode): the unique index
 *                 refuses a second, so a second create finds the first
 *   claim         pending becomes creating for exactly one caller
 *   finish        the answer of a create, only for the claim's owner
 *   transition    a state change only from the states it may come from
 *   expireLeases  a create whose process died becomes unknown, never pending
 *                 (the return may exist: the Returns API has no search)
 */

import type { ReturnRow } from "./returns"
import type { SqlRunner } from "./store"

export const RETURN_TABLE = "inpost_parcel_return"

export type ReturnPatch = Partial<
  Pick<
    ReturnRow,
    | "display_id"
    | "state"
    | "method"
    | "reference"
    | "plan_hash"
    | "shipment_id"
    | "inpost_parcel_id"
    | "tracking_number"
    | "short_number"
    | "drop_off_code"
    | "has_label"
    | "expires_at"
    | "skip_reason"
    | "error"
    | "error_code"
    | "created_by"
    | "shipment_created_at"
    | "last_checked_at"
  >
>

export interface NewReturn {
  order_id: string
  display_id: number | null
  return_id: string | null
  return_key: string
  demo: boolean
  state: string
  method?: string | null
  reference?: string | null
  shipment_id?: string | null
  inpost_parcel_id?: string | null
  tracking_number?: string | null
  short_number?: string | null
  drop_off_code?: string | null
  has_label?: boolean
  expires_at?: Date | null
  shipment_created_at?: Date | null
  created_by?: string | null
}

export interface ReturnStore {
  insertIgnore(row: NewReturn): Promise<ReturnRow | null>
  claim(id: string, args: { token: string; now: Date; leaseUntil: Date }): Promise<ReturnRow | null>
  finish(id: string, token: string, patch: ReturnPatch): Promise<boolean>
  transition(id: string, from: readonly string[], patch: ReturnPatch): Promise<ReturnRow | null>
  expireLeases(now: Date, demo: boolean): Promise<number>
  /** Rows per state of one mode, for the counters. */
  counts(demo: boolean): Promise<Array<{ state: string; count: number }>>
}

/** Columns a patch may set. Only these names ever reach the SQL text. */
export const RETURN_PATCHABLE_COLUMNS: readonly string[] = [
  "display_id",
  "state",
  "method",
  "reference",
  "plan_hash",
  "shipment_id",
  "inpost_parcel_id",
  "tracking_number",
  "short_number",
  "drop_off_code",
  "has_label",
  "expires_at",
  "skip_reason",
  "error",
  "error_code",
  "created_by",
  "shipment_created_at",
  "last_checked_at",
]

export function returnSetClause(patch: ReturnPatch): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  const values = patch as Record<string, unknown>
  for (const column of RETURN_PATCHABLE_COLUMNS) {
    if (!(column in values) || values[column] === undefined) continue
    parts.push(`"${column}" = ?`)
    bindings.push(values[column])
  }
  parts.push(`"updated_at" = now()`)
  return { sql: parts.join(", "), bindings }
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

export function createSqlReturnStore(deps: { sql: SqlRunner; newId: (prefix: string) => string }): ReturnStore {
  const { sql, newId } = deps
  return {
    async insertIgnore(row) {
      const result = await sql.raw(
        `insert into "${RETURN_TABLE}" ("id", "order_id", "display_id", "return_id", "return_key", "demo", "state", "method", "reference",
           "shipment_id", "inpost_parcel_id", "tracking_number", "short_number", "drop_off_code", "has_label", "expires_at", "shipment_created_at",
           "created_by", "attempts", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId("inret"),
          row.order_id,
          row.display_id,
          row.return_id,
          row.return_key,
          row.demo,
          row.state,
          row.method ?? null,
          row.reference ?? null,
          row.shipment_id ?? null,
          row.inpost_parcel_id ?? null,
          row.tracking_number ?? null,
          row.short_number ?? null,
          row.drop_off_code ?? null,
          row.has_label ?? false,
          row.expires_at ?? null,
          row.shipment_created_at ?? null,
          row.created_by ?? null,
        ],
      )
      return rowsOf<ReturnRow>(result)[0] ?? null
    },

    async claim(id, args) {
      const result = await sql.raw(
        `update "${RETURN_TABLE}"
         set "state" = 'creating', "claim_token" = ?, "claimed_at" = ?, "lease_until" = ?, "attempts" = "attempts" + 1, "updated_at" = now()
         where "id" = ? and "state" = 'pending' and "deleted_at" is null
         returning *`,
        [args.token, args.now, args.leaseUntil, id],
      )
      return rowsOf<ReturnRow>(result)[0] ?? null
    },

    async finish(id, token, patch) {
      const set = returnSetClause(patch)
      const result = await sql.raw(
        `update "${RETURN_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "state" = 'creating' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },

    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = returnSetClause(patch)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${RETURN_TABLE}" set ${set.sql}
         where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<ReturnRow>(result)[0] ?? null
    },

    async expireLeases(now, demo) {
      const result = await sql.raw(
        `update "${RETURN_TABLE}"
         set "state" = 'unknown', "claim_token" = null, "lease_until" = null, "error_code" = 'lease_expired', "error" = ?, "updated_at" = now()
         where "state" = 'creating' and "lease_until" < ? and "demo" = ? and "deleted_at" is null
         returning "id"`,
        ["The process stopped while the return was being created. It may exist in InPost: check there, then try again or mark it handled.", now, demo],
      )
      return rowsOf(result).length
    },

    async counts(demo) {
      const result = await sql.raw(
        `select "state", count(*)::int as "count" from "${RETURN_TABLE}"
         where "demo" = ? and "deleted_at" is null
         group by "state"`,
        [demo],
      )
      return rowsOf<{ state: string; count: number | string }>(result).map((r) => ({ state: r.state, count: Number(r.count) || 0 }))
    },
  }
}
