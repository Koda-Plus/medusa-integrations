/**
 * THE ATOMIC OPERATIONS, in SQL. Types and SQL text only: the connection is
 * injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory store that keeps the same
 * rules (test/helpers.ts).
 *
 * WHY RAW SQL: the generated service updates "by selector" by listing rows
 * first and updating them by id afterwards, so two processes could both see a
 * pending row and both send it. Every step that decides who acts is ONE
 * statement here:
 *
 *   insertIgnore    a row per fulfillment; the unique index refuses a second
 *   claim           pending becomes creating for exactly one caller
 *   finish          the result of a create, only for the claim's owner
 *   transition      a state change only from the states it may come from
 *   applyStatus     a ShipX status only over the status the caller read
 *                   (compare and set): one change, one event, whoever wins
 *   claimBuy        one purchase of a prepaid offer per ten minutes
 *   claimDispatch   one courier pickup per shipment
 *   claimMark       one "shipped" and one "delivered" per fulfillment
 *   insertEvent     a history row, ignored when its dedupe key exists
 *   setSetting      one row per key, written in one statement
 *   claimSetting    a key only the first caller writes (the demo seed)
 */

import type { EventRow, ParcelRow, SettingRow } from "./dto"

export type ParcelPatch = Partial<
  Pick<
    ParcelRow,
    | "display_id"
    | "locker_code"
    | "locker_name"
    | "locker_address"
    | "parcel_size"
    | "cod_minor"
    | "currency"
    | "reference"
    | "state"
    | "status"
    | "status_at"
    | "shipment_id"
    | "tracking_number"
    | "sending_method"
    | "plan_hash"
    | "problems"
    | "skip_reason"
    | "external"
    | "error"
    | "error_code"
    | "claimed_at"
    | "created_by"
    | "shipment_created_at"
    | "offer"
    | "buy_requested_at"
    | "dispatch_state"
    | "dispatch_order_id"
    | "dispatch_error"
    | "dispatch_at"
    | "fulfillment_canceled_at"
    | "shipped_marked_at"
    | "delivered_marked_at"
    | "status_writer_error"
    | "last_checked_at"
  >
>

export interface NewParcel {
  order_id: string
  display_id: number | null
  fulfillment_id: string | null
  demo: boolean
  option_id: string
  kind: string
  cod: boolean
  service: string
  locker_code: string | null
  locker_name: string | null
  locker_address: unknown
  parcel_size: string | null
  parcel_no: number
  currency: string | null
  state: string
  skip_reason?: string | null
  external?: boolean
  shipment_id?: string | null
  status?: string | null
  tracking_number?: string | null
  shipment_created_at?: Date | null
  created_by?: string | null
  problems?: unknown
}

export interface NewEvent {
  parcel_id: string | null
  order_id: string | null
  shipment_id: string | null
  kind: string
  status?: string | null
  previous_status?: string | null
  source?: string | null
  message?: string | null
  data?: unknown
  actor?: string | null
  dedupe_key?: string | null
  demo: boolean
  occurred_at?: Date
}

export interface StatusUpdate {
  status: string
  tracking_number?: string | null
  offer?: unknown
  at: Date
}

export interface ParcelStore {
  insertIgnore(row: NewParcel): Promise<ParcelRow | null>
  claim(id: string, args: { token: string; now: Date; leaseUntil: Date }): Promise<ParcelRow | null>
  finish(id: string, token: string, patch: ParcelPatch): Promise<boolean>
  transition(id: string, from: readonly string[], patch: ParcelPatch): Promise<ParcelRow | null>
  /** Sets the status only when the row still has `expected` (null: no status yet) and the new one differs. */
  applyStatus(id: string, expected: string | null, update: StatusUpdate): Promise<ParcelRow | null>
  /** Records a read that found no change (the status pass moves on to other rows). */
  touch(id: string, at: Date): Promise<void>
  claimBuy(id: string, now: Date): Promise<ParcelRow | null>
  claimDispatch(ids: readonly string[], now: Date): Promise<string[]>
  claimMark(id: string, field: "shipped_marked_at" | "delivered_marked_at", now: Date): Promise<boolean>
  releaseMark(id: string, field: "shipped_marked_at" | "delivered_marked_at", error: string | null): Promise<void>
  expireLeases(now: Date, demo: boolean): Promise<number>
  insertEvent(event: NewEvent): Promise<EventRow | null>
  pruneEvents(before: Date): Promise<number>
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRow | null>
  claimSetting(key: string, value: unknown): Promise<boolean>
  /** Rows per state and status of one mode, for the counters of the Panel. */
  counts(demo: boolean): Promise<Array<{ state: string; status: string | null; count: number }>>
}

/** The smallest piece of Knex the store needs. */
export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export const PARCEL_TABLE = "inpost_parcel"
export const EVENT_TABLE = "inpost_parcel_event"
export const SETTING_TABLE = "inpost_setting"

/** Columns a patch may set. Only these names ever reach the SQL text. */
export const PATCHABLE_COLUMNS: readonly string[] = [
  "display_id",
  "locker_code",
  "locker_name",
  "locker_address",
  "parcel_size",
  "cod_minor",
  "currency",
  "reference",
  "state",
  "status",
  "status_at",
  "shipment_id",
  "tracking_number",
  "sending_method",
  "plan_hash",
  "problems",
  "skip_reason",
  "external",
  "error",
  "error_code",
  "claimed_at",
  "created_by",
  "shipment_created_at",
  "offer",
  "buy_requested_at",
  "dispatch_state",
  "dispatch_order_id",
  "dispatch_error",
  "dispatch_at",
  "fulfillment_canceled_at",
  "shipped_marked_at",
  "delivered_marked_at",
  "status_writer_error",
  "last_checked_at",
]

const JSON_COLUMNS: ReadonlySet<string> = new Set(["locker_address", "problems", "offer"])

export function setClause(patch: ParcelPatch): { sql: string; bindings: unknown[] } {
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

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v))

export function createSqlStore(deps: { sql: SqlRunner; newId: (prefix: string) => string }): ParcelStore {
  const { sql, newId } = deps
  return {
    async insertIgnore(row) {
      const result = await sql.raw(
        `insert into "${PARCEL_TABLE}" ("id", "order_id", "display_id", "fulfillment_id", "demo", "option_id", "kind", "cod", "service",
           "locker_code", "locker_name", "locker_address", "parcel_size", "parcel_no", "currency", "state", "skip_reason", "external",
           "shipment_id", "status", "tracking_number", "shipment_created_at", "created_by", "problems", "attempts", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, 0, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId("inpar"),
          row.order_id,
          row.display_id,
          row.fulfillment_id,
          row.demo,
          row.option_id,
          row.kind,
          row.cod,
          row.service,
          row.locker_code,
          row.locker_name,
          json(row.locker_address),
          row.parcel_size,
          row.parcel_no,
          row.currency,
          row.state,
          row.skip_reason ?? null,
          row.external ?? false,
          row.shipment_id ?? null,
          row.status ?? null,
          row.tracking_number ?? null,
          row.shipment_created_at ?? null,
          row.created_by ?? null,
          json(row.problems),
        ],
      )
      return rowsOf<ParcelRow>(result)[0] ?? null
    },

    async claim(id, args) {
      const result = await sql.raw(
        `update "${PARCEL_TABLE}"
         set "state" = 'creating', "claim_token" = ?, "claimed_at" = ?, "lease_until" = ?, "attempts" = "attempts" + 1, "updated_at" = now()
         where "id" = ? and "state" = 'pending' and "deleted_at" is null
         returning *`,
        [args.token, args.now, args.leaseUntil, id],
      )
      return rowsOf<ParcelRow>(result)[0] ?? null
    },

    async finish(id, token, patch) {
      const set = setClause(patch)
      const result = await sql.raw(
        `update "${PARCEL_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "state" = 'creating' and "claim_token" = ? and "deleted_at" is null
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
        `update "${PARCEL_TABLE}" set ${set.sql}
         where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<ParcelRow>(result)[0] ?? null
    },

    async applyStatus(id, expected, update) {
      const result = await sql.raw(
        `update "${PARCEL_TABLE}"
         set "status" = ?, "status_at" = ?, "last_checked_at" = ?,
             "tracking_number" = coalesce(?, "tracking_number"),
             "offer" = case when ?::jsonb is null then "offer" else ?::jsonb end,
             "updated_at" = now()
         where "id" = ? and "deleted_at" is null
           and coalesce("status", '') = ? and coalesce("status", '') <> ?
         returning *`,
        [update.status, update.at, update.at, update.tracking_number ?? null, json(update.offer), json(update.offer), id, expected ?? "", update.status],
      )
      return rowsOf<ParcelRow>(result)[0] ?? null
    },

    async touch(id, at) {
      await sql.raw(`update "${PARCEL_TABLE}" set "last_checked_at" = ?, "updated_at" = now() where "id" = ? and "deleted_at" is null`, [at, id])
    },

    async claimBuy(id, now) {
      const result = await sql.raw(
        `update "${PARCEL_TABLE}" set "buy_requested_at" = ?, "updated_at" = now()
         where "id" = ? and "status" = 'offers_prepared' and "deleted_at" is null
           and ("buy_requested_at" is null or "buy_requested_at" < ?)
         returning *`,
        [now, id, new Date(now.getTime() - 10 * 60 * 1000)],
      )
      return rowsOf<ParcelRow>(result)[0] ?? null
    },

    async claimDispatch(ids, now) {
      if (ids.length === 0) return []
      const placeholders = ids.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${PARCEL_TABLE}" set "dispatch_state" = 'requesting', "dispatch_at" = ?, "dispatch_error" = null, "updated_at" = now()
         where "id" in (${placeholders}) and "deleted_at" is null and "status" = 'confirmed'
           and ("dispatch_state" is null or "dispatch_state" = 'failed')
         returning "id"`,
        [now, ...ids],
      )
      return rowsOf<{ id: string }>(result).map((r) => r.id)
    },

    async claimMark(id, field, now) {
      const column = field === "shipped_marked_at" ? "shipped_marked_at" : "delivered_marked_at"
      const result = await sql.raw(
        `update "${PARCEL_TABLE}" set "${column}" = ?, "status_writer_error" = null, "updated_at" = now()
         where "id" = ? and "${column}" is null and "deleted_at" is null
         returning "id"`,
        [now, id],
      )
      return rowsOf(result).length > 0
    },

    async releaseMark(id, field, error) {
      const column = field === "shipped_marked_at" ? "shipped_marked_at" : "delivered_marked_at"
      await sql.raw(`update "${PARCEL_TABLE}" set "${column}" = null, "status_writer_error" = ?, "updated_at" = now() where "id" = ?`, [error, id])
    },

    async expireLeases(now, demo) {
      const result = await sql.raw(
        `update "${PARCEL_TABLE}"
         set "state" = 'unknown', "claim_token" = null, "lease_until" = null, "error_code" = 'lease_expired', "error" = ?, "updated_at" = now()
         where "state" = 'creating' and "lease_until" < ? and "demo" = ? and "deleted_at" is null
         returning "id"`,
        ["The process stopped while the shipment was being created. It is looked up in ShipX before anything is sent again.", now, demo],
      )
      return rowsOf(result).length
    },

    async insertEvent(event) {
      const result = await sql.raw(
        `insert into "${EVENT_TABLE}" ("id", "parcel_id", "order_id", "shipment_id", "kind", "status", "previous_status", "source", "message",
           "data", "actor", "dedupe_key", "demo", "occurred_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId("inpev"),
          event.parcel_id,
          event.order_id,
          event.shipment_id,
          event.kind,
          event.status ?? null,
          event.previous_status ?? null,
          event.source ?? null,
          event.message ? event.message.slice(0, 2000) : null,
          json(event.data),
          event.actor ?? null,
          event.dedupe_key ?? null,
          event.demo,
          event.occurred_at ?? new Date(),
        ],
      )
      return rowsOf<EventRow>(result)[0] ?? null
    },

    async pruneEvents(before) {
      const result = await sql.raw(`delete from "${EVENT_TABLE}" where "occurred_at" < ? returning "id"`, [before])
      return rowsOf(result).length
    },

    async setSetting(key, value, updatedBy) {
      const result = await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at")
         values (?, ?, ?::jsonb, ?, now(), now())
         on conflict ("key") do update set "value" = excluded."value", "updated_by" = excluded."updated_by", "updated_at" = now(), "deleted_at" = null
         returning *`,
        [newId("inset"), key, json(value), updatedBy],
      )
      return rowsOf<SettingRow>(result)[0] ?? null
    },

    async claimSetting(key, value) {
      const result = await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "created_at", "updated_at")
         values (?, ?, ?::jsonb, now(), now())
         on conflict ("key") do nothing
         returning "id"`,
        [newId("inset"), key, json(value)],
      )
      return rowsOf(result).length > 0
    },

    async counts(demo) {
      const result = await sql.raw(
        `select "state", "status", count(*)::int as "count" from "${PARCEL_TABLE}"
         where "demo" = ? and "deleted_at" is null
         group by "state", "status"`,
        [demo],
      )
      return rowsOf<{ state: string; status: string | null; count: number | string }>(result).map((r) => ({ state: r.state, status: r.status ?? null, count: Number(r.count) || 0 }))
    },
  }
}
