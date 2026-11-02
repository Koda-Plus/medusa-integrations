/**
 * THE ATOMIC OPERATIONS, in SQL. Types and SQL text only: the connection is
 * injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory store that keeps the same
 * rules (test/helpers.ts).
 *
 * WHY RAW SQL: the generated service updates "by selector" by listing rows
 * first and updating them by id afterwards, so two processes could both see
 * a pending row and both act on it. Every step that decides who acts is ONE
 * statement here:
 *
 *   insertIgnore    a row per fulfillment, kind and mode; the unique index
 *                   refuses a second one
 *   transition      a state change only from the states it may come from,
 *                   setting only the columns of PATCHABLE_COLUMNS
 *   insertEvent     a history row, ignored when its dedupe key exists
 *   setSetting      one row per key, written in one statement
 *   claimSetting    a key only the first caller writes (the demo seed)
 *   releaseSetting  that key removed again (a seed that failed half way)
 *
 * The `on conflict` of the settings names the partial unique index of the
 * migration (key, among the rows not deleted): Postgres only infers a
 * partial index when the statement repeats its condition.
 *
 * And the reads of the Panel and the contract, in the same SQL so a list and
 * its counter never disagree:
 *
 *   counts          rows per group of one mode (GROUP_SQL, the rule of
 *                   groupOf in contract.ts)
 *   list            one page of a group of one mode, with the search
 *
 * The claims with a lease, for every call that writes to DPD:
 *
 *   claim           a row in one of the given states moves to creating or
 *                   labeling with a token and a lease (attempts + 1); a
 *                   second process finds the state changed and gets null
 *   finish          only the owner of the claim (state creating or labeling
 *                   and the same token) writes the result; a claim whose
 *                   lease ran out was taken back, so a late answer writes
 *                   nothing. A claim the pacing refused (nothing sent) is
 *                   finished with `unsent`: attempts goes back to its value
 *                   before the claim, so only claims that sent a request
 *                   count toward AUTO_LABEL_MAX_ATTEMPTS
 *   expireLeases    creating past its lease becomes unknown (looked up
 *                   before anything is sent again), labeling past its lease
 *                   goes back to created (the label can be asked again)
 *
 * The courier order (stage 4) gets its own claim on dpd_dispatch.
 */

import { SHIPMENT_GROUPS, type ShipmentFilter, type ShipmentGroup } from "./contract"
import type { DpdMode } from "./constants"
import type { EventRow, SettingRow, ShipmentRow } from "./dto"

export type ShipmentPatch = Partial<
  Pick<
    ShipmentRow,
    | "display_id"
    | "service"
    | "pudo_id"
    | "country_code"
    | "session_type"
    | "cod_minor"
    | "currency"
    | "reference"
    | "references"
    | "boxes"
    | "waybills"
    | "session_id"
    | "state"
    | "status"
    | "stage"
    | "plan_hash"
    | "problems"
    | "dispatch_id"
    | "handed_over_at"
    | "shipped_marked_at"
    | "delivered_marked_at"
    | "last_checked_at"
    | "error"
    | "error_code"
  >
>

/** A new row. No receiver data: the plan reads the address from the order when it is built. */
export type NewShipment = {
  order_id: string | null
  display_id: number | null
  fulfillment_id: string | null
  return_id: string | null
  kind: "outbound" | "return"
  mode: DpdMode
  option_id: string
  service: string | null
  pudo_id: string | null
  country_code: string | null
  session_type: string | null
  cod_minor: number | null
  currency: string | null
  reference: string | null
  state: string
  problems?: unknown
}

export type NewEvent = {
  shipment_id: string | null
  dispatch_id?: string | null
  order_id: string | null
  waybill?: string | null
  kind: "status" | "action" | "run"
  status?: string | null
  previous_status?: string | null
  source?: string | null
  message?: string | null
  data?: unknown
  actor?: string | null
  dedupe_key?: string | null
  object_id?: string | null
  mode: DpdMode
  occurred_at?: Date
}

export type ListArgs = {
  mode: DpdMode
  filter: ShipmentFilter
  /** Order number, order or fulfillment id, waybill, Pickup point, reference. */
  q?: string | null
  offset: number
  limit: number
}

export type ClaimArgs = {
  token: string
  leaseUntil: Date
  to: "creating" | "labeling"
  /** Columns set in the same statement (plan_hash, cod_minor, boxes...). `state` in it is ignored. */
  patch?: ShipmentPatch
}

/** How a claim ends besides its patch. */
export type FinishOptions = {
  /**
   * The claim sent nothing (the client's pacing refused the call): attempts
   * goes back to its value before the claim (attempts - 1, never below 0),
   * and updated_at to `updatedAt` when it is given (a lookup that never left
   * keeps the clock its settle check runs on).
   */
  unsent?: { updatedAt?: Date | null }
}

/** The states a claim moves a row to; finish only writes from these. */
export const CLAIMED_STATES: readonly string[] = ["creating", "labeling"]

export const LEASE_EXPIRED_ERROR = "No answer from DPD within the lease; the shipment is looked up before anything is sent again."
export const LABEL_LEASE_EXPIRED_ERROR = "Getting the label took longer than its lease; get it again."

export type DpdStore = {
  /** state in `from` -> `to`, with the token and the lease, attempts + 1, updated_at = now(). Null when another process won. */
  claim(id: string, from: readonly string[], args: ClaimArgs): Promise<ShipmentRow | null>
  /** Only the owner of the claim: state in (creating, labeling) and claim_token = token. Clears token and lease; `unsent` undoes the count of the claim. */
  finish(id: string, token: string, patch: ShipmentPatch & { state: string }, options?: FinishOptions): Promise<ShipmentRow | null>
  /** creating past its lease -> unknown (lease_expired); labeling past its lease -> created (label_lease_expired). Returns the rows changed. */
  expireLeases(mode: DpdMode, now: Date): Promise<ShipmentRow[]>
  insertIgnore(row: NewShipment): Promise<ShipmentRow | null>
  transition(id: string, from: readonly string[], patch: ShipmentPatch): Promise<ShipmentRow | null>
  insertEvent(event: NewEvent): Promise<EventRow | null>
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRow | null>
  claimSetting(key: string, value: unknown): Promise<boolean>
  /** Removes a key for good (a hard delete), so the next claimSetting of it wins again. */
  releaseSetting(key: string): Promise<void>
  /** Rows per Panel group of one mode. */
  counts(mode: DpdMode): Promise<Array<{ group: ShipmentGroup; count: number }>>
  /** One page of a Panel list of one mode, newest first, and the number of rows of the whole list. */
  list(args: ListArgs): Promise<{ rows: ShipmentRow[]; count: number }>
}

/** The smallest piece of Knex the store needs. */
export type SqlRunner = {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export const SHIPMENT_TABLE = "dpd_shipment"
export const EVENT_TABLE = "dpd_event"
export const SETTING_TABLE = "dpd_setting"

/** Columns a patch may set. Only these names ever reach the SQL text. */
export const PATCHABLE_COLUMNS: readonly string[] = [
  "display_id",
  "service",
  "pudo_id",
  "country_code",
  "session_type",
  "cod_minor",
  "currency",
  "reference",
  "references",
  "boxes",
  "waybills",
  "session_id",
  "state",
  "status",
  "stage",
  "plan_hash",
  "problems",
  "dispatch_id",
  "handed_over_at",
  "shipped_marked_at",
  "delivered_marked_at",
  "last_checked_at",
  "error",
  "error_code",
]

const JSON_COLUMNS: ReadonlySet<string> = new Set(["references", "boxes", "waybills", "problems"])

/**
 * The Panel group of a row in SQL, branch for branch the rule of groupOf in
 * contract.ts (the admin and the memory store use groupOf itself):
 * canceled or skipped first, then returns, then the refusals and unclear
 * answers, then the stage DPD reports, then the label and the handover.
 */
export const GROUP_SQL = `case
  when "state" in ('canceled', 'skipped') then 'canceled'
  when "kind" = 'return' then 'returns'
  when "state" in ('failed', 'unknown', 'ambiguous', 'abandoned_unknown') then 'problems'
  when "stage" in ('problem', 'returned') then 'problems'
  when "stage" = 'canceled' then 'canceled'
  when "stage" = 'delivered' then 'delivered'
  when "stage" in ('in_transit', 'in_point') then 'in_transit'
  when "state" <> 'labeled' then 'to_create'
  when "handed_over_at" is not null then 'handed_over'
  else 'labeled'
end`

/** The `set` list of a patch; updated_at is now(), or `updatedAt` when one is given. */
export function setClause(patch: ShipmentPatch, updatedAt?: Date | null): { sql: string; bindings: unknown[] } {
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
  if (updatedAt) {
    parts.push(`"updated_at" = ?`)
    bindings.push(updatedAt)
  } else {
    parts.push(`"updated_at" = now()`)
  }
  return { sql: parts.join(", "), bindings }
}

/** `%q%` for `ilike`, with the wildcard characters of the search escaped. */
export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** The search as a person types it: trimmed, without a leading "#" of an order number. */
export function searchText(q: string | null | undefined): string {
  return String(q ?? "").trim().replace(/^#/, "").slice(0, 100)
}

/** The search condition and its bindings, or null for an empty search. */
export function searchClause(q: string | null | undefined): { sql: string; bindings: unknown[] } | null {
  const s = searchText(q)
  if (!s) return null
  const parts = [`"order_id" = ?`, `"fulfillment_id" = ?`, `"pudo_id" ilike ?`, `"waybills"::text ilike ?`, `"reference" ilike ?`]
  const bindings: unknown[] = [s, s, like(s), like(s), like(s)]
  if (/^\d{1,9}$/.test(s)) {
    parts.push(`"display_id" = ?`)
    bindings.push(Number(s))
  }
  return { sql: `(${parts.join(" or ")})`, bindings }
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v))

export function isGroup(v: unknown): v is ShipmentGroup {
  return typeof v === "string" && (SHIPMENT_GROUPS as readonly string[]).includes(v)
}

export function createSqlStore(deps: { sql: SqlRunner; newId: (prefix: string) => string }): DpdStore {
  const { sql, newId } = deps
  return {
    async claim(id, from, args) {
      if (from.length === 0) return null
      const { state: _ignored, ...patch } = args.patch ?? {}
      const set = setClause(patch)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set ${set.sql}, "state" = ?, "claim_token" = ?, "lease_until" = ?, "attempts" = "attempts" + 1
         where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, args.to, args.token, args.leaseUntil, id, ...from],
      )
      return rowsOf<ShipmentRow>(result)[0] ?? null
    },

    async finish(id, token, patch, options) {
      const set = setClause(patch, options?.unsent?.updatedAt)
      const uncount = options?.unsent ? `, "attempts" = greatest("attempts" - 1, 0)` : ""
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null${uncount}
         where "id" = ? and "state" in ('creating', 'labeling') and "claim_token" = ? and "deleted_at" is null
         returning *`,
        [...set.bindings, id, token],
      )
      return rowsOf<ShipmentRow>(result)[0] ?? null
    },

    async expireLeases(mode, now) {
      const created = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "state" = 'unknown', "error_code" = 'lease_expired', "error" = ?,
           "claim_token" = null, "lease_until" = null, "updated_at" = now()
         where "mode" = ? and "state" = 'creating' and "lease_until" < ? and "deleted_at" is null
         returning *`,
        [LEASE_EXPIRED_ERROR, mode, now],
      )
      const labels = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "state" = 'created', "error_code" = 'label_lease_expired', "error" = ?,
           "claim_token" = null, "lease_until" = null, "updated_at" = now()
         where "mode" = ? and "state" = 'labeling' and "lease_until" < ? and "deleted_at" is null
         returning *`,
        [LABEL_LEASE_EXPIRED_ERROR, mode, now],
      )
      return [...rowsOf<ShipmentRow>(created), ...rowsOf<ShipmentRow>(labels)]
    },

    async insertIgnore(row) {
      const result = await sql.raw(
        `insert into "${SHIPMENT_TABLE}" ("id", "order_id", "display_id", "fulfillment_id", "return_id", "kind", "mode", "option_id", "service",
           "pudo_id", "country_code", "session_type", "cod_minor", "currency", "reference", "state", "problems", "attempts", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, 0, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId("dpdshp"),
          row.order_id,
          row.display_id,
          row.fulfillment_id,
          row.return_id,
          row.kind,
          row.mode,
          row.option_id,
          row.service,
          row.pudo_id,
          row.country_code,
          row.session_type,
          row.cod_minor,
          row.currency,
          row.reference,
          row.state,
          json(row.problems),
        ],
      )
      return rowsOf<ShipmentRow>(result)[0] ?? null
    },

    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = setClause(patch)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set ${set.sql}
         where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<ShipmentRow>(result)[0] ?? null
    },

    async insertEvent(event) {
      const result = await sql.raw(
        `insert into "${EVENT_TABLE}" ("id", "shipment_id", "dispatch_id", "order_id", "waybill", "kind", "status", "previous_status", "source",
           "message", "data", "actor", "dedupe_key", "object_id", "mode", "occurred_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId("dpdevt"),
          event.shipment_id,
          event.dispatch_id ?? null,
          event.order_id,
          event.waybill ?? null,
          event.kind,
          event.status ?? null,
          event.previous_status ?? null,
          event.source ?? null,
          event.message ? event.message.slice(0, 2000) : null,
          json(event.data),
          event.actor ?? null,
          event.dedupe_key ?? null,
          event.object_id ?? null,
          event.mode,
          event.occurred_at ?? new Date(),
        ],
      )
      return rowsOf<EventRow>(result)[0] ?? null
    },

    async setSetting(key, value, updatedBy) {
      const result = await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at")
         values (?, ?, ?::jsonb, ?, now(), now())
         on conflict ("key") where "deleted_at" is null do update set "value" = excluded."value", "updated_by" = excluded."updated_by", "updated_at" = now()
         returning *`,
        [newId("dpdset"), key, json(value), updatedBy],
      )
      return rowsOf<SettingRow>(result)[0] ?? null
    },

    async claimSetting(key, value) {
      const result = await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "created_at", "updated_at")
         values (?, ?, ?::jsonb, now(), now())
         on conflict ("key") where "deleted_at" is null do nothing
         returning "id"`,
        [newId("dpdset"), key, json(value)],
      )
      return rowsOf(result).length > 0
    },

    async releaseSetting(key) {
      await sql.raw(`delete from "${SETTING_TABLE}" where "key" = ?`, [key])
    },

    async counts(mode) {
      const result = await sql.raw(
        `select ${GROUP_SQL} as "group", count(*)::int as "count" from "${SHIPMENT_TABLE}"
         where "mode" = ? and "deleted_at" is null
         group by 1`,
        [mode],
      )
      return rowsOf<{ group: unknown; count: number | string }>(result)
        .filter((r): r is { group: ShipmentGroup; count: number | string } => isGroup(r.group))
        .map((r) => ({ group: r.group, count: Number(r.count) || 0 }))
    },

    async list(args) {
      const where: string[] = [`"mode" = ?`, `"deleted_at" is null`]
      const bindings: unknown[] = [args.mode]
      if (args.filter !== "all") {
        where.push(`(${GROUP_SQL}) = ?`)
        bindings.push(args.filter)
      }
      const search = searchClause(args.q)
      if (search) {
        where.push(search.sql)
        bindings.push(...search.bindings)
      }
      const condition = where.join(" and ")
      const rows = await sql.raw(
        `select * from "${SHIPMENT_TABLE}" where ${condition}
         order by "created_at" desc, "id" desc
         limit ? offset ?`,
        [...bindings, args.limit, args.offset],
      )
      const total = await sql.raw(`select count(*)::int as "count" from "${SHIPMENT_TABLE}" where ${condition}`, bindings)
      const count = Number(rowsOf<{ count: number | string }>(total)[0]?.count ?? 0) || 0
      return { rows: rowsOf<ShipmentRow>(rows), count }
    },
  }
}
