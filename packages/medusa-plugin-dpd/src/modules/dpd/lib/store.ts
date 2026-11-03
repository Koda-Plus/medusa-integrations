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
 *                   setting only the columns of PATCHABLE_COLUMNS; with
 *                   `expect`, only while the row still has the point and
 *                   the boxes a plan was built from (a write of problems
 *                   never lands on a row whose point changed meanwhile)
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
 *                   second process finds the state changed and gets null.
 *                   With `expect` (the create), only while the row still
 *                   has the point and the boxes its plan read: a change
 *                   saved while the plan waited is never overwritten by
 *                   the patch, nor sent to DPD
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
 * The handover to the courier (stage 4) gets its own claim on dpd_dispatch:
 *
 *   createDispatch  the dispatch and the dispatch_id of its shipments in one
 *                   statement; null when any shipment is not free
 *   claimDispatch   a dispatch moves to printing, ordering or updating with a
 *                   token and a lease (DISPATCH_CLAIMED_STATES)
 *   finishDispatch  only the owner of that claim writes the result
 *   transitionDispatch    a change from the given states, never of a
 *                         claimed row
 *   expireDispatchLeases  a claim past its lease goes back to where it is
 *                         safe (DS8)
 */

import { DISPATCH_ATTENTION_CODES, SHIPMENT_GROUPS, type DispatchFilter, type ShipmentFilter, type ShipmentGroup } from "./contract"
import { DISPATCH_CLAIMED_STATES, type DispatchState, type DpdMode } from "./constants"
import type { DispatchRow, EventRow, SettingRow, ShipmentRow } from "./dto"

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
  /** The plan inputs the patch was built from, compared like the expect of transition (before the patch writes). */
  expect?: TransitionExpect
}

/**
 * What a transition expects the row to hold besides its state: the inputs of
 * the plan its patch was built from. A key left out is not compared; null
 * matches a null column.
 */
export type TransitionExpect = {
  pudo_id?: string | null
  /** Compared as jsonb (the same boxes in another key order are the same). */
  boxes?: unknown
  /** Compared with "is not distinct from" (null matches a free row). */
  dispatch_id?: string | null
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

export type DispatchPatch = Partial<
  Pick<
    DispatchRow,
    | "state"
    | "location_id"
    | "sender"
    | "params"
    | "problems"
    | "plan_hash"
    | "shipment_ids"
    | "protocols"
    | "protocol_at"
    | "pickup_date"
    | "pickup_time_from"
    | "pickup_time_to"
    | "order_type"
    | "order_number"
    | "check_sum"
    | "ordered_at"
    | "error"
    | "error_code"
    | "updated_by"
  >
>

/** A new dispatch: state pending, id newId("dpddsp"), shipment_ids the ids given to createDispatch. */
export type NewDispatch = {
  mode: DpdMode
  location_id: string | null
  sender: unknown
  params: unknown
  problems: unknown
  plan_hash: string
  order_type: "DOMESTIC"
  created_by: string | null
}

export type DispatchClaimArgs = {
  token: string
  leaseUntil: Date
  to: "printing" | "ordering" | "updating"
  /** Set in the same statement. error_code here is what a lease expiry leaves (protocol_unclear, order_unclear, update_unclear, cancel_unclear); finishDispatch always overwrites it. */
  patch: DispatchPatch
  /** The row as the step read it, compared like the expect of transitionDispatch: the steps pass the error_code they read, so an attention code set or cleared meanwhile is never written back from the stale read (P10). */
  expect?: DispatchExpect
}

/* DispatchFilter comes from contract.ts: the admin needs it too. */
export type DispatchListArgs = { mode: DpdMode; filter: DispatchFilter; offset: number; limit: number }

export type DpdStore = {
  /** state in `from` -> `to`, with the token and the lease, attempts + 1, updated_at = now(). Null when another process won or the row no longer holds `args.expect`. */
  claim(id: string, from: readonly string[], args: ClaimArgs): Promise<ShipmentRow | null>
  /** Only the owner of the claim: state in (creating, labeling) and claim_token = token. Clears token and lease; `unsent` undoes the count of the claim. */
  finish(id: string, token: string, patch: ShipmentPatch & { state: string }, options?: FinishOptions): Promise<ShipmentRow | null>
  /** creating past its lease -> unknown (lease_expired); labeling past its lease -> created (label_lease_expired). Returns the rows changed. */
  expireLeases(mode: DpdMode, now: Date): Promise<ShipmentRow[]>
  insertIgnore(row: NewShipment): Promise<ShipmentRow | null>
  /** state in `from` (and the columns of `expect` as given) -> patch, updated_at = now(). Null when the row is not there, moved on or changed meanwhile. */
  transition(id: string, from: readonly string[], patch: ShipmentPatch, expect?: TransitionExpect): Promise<ShipmentRow | null>
  insertEvent(event: NewEvent): Promise<EventRow | null>
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRow | null>
  claimSetting(key: string, value: unknown): Promise<boolean>
  /** Removes a key for good (a hard delete), so the next claimSetting of it wins again. */
  releaseSetting(key: string): Promise<void>
  /** Rows per Panel group of one mode. */
  counts(mode: DpdMode): Promise<Array<{ group: ShipmentGroup; count: number }>>
  /** One page of a Panel list of one mode, newest first, and the number of rows of the whole list. */
  list(args: ListArgs): Promise<{ rows: ShipmentRow[]; count: number }>
  /** One statement (CTE): locks the shipments for update, requires every id outbound, labeled, of `row.mode`, session_type DOMESTIC or null, dispatch_id null, handed_over_at null; inserts the dispatch (state pending, shipment_ids = ids, id newId("dpddsp")) and sets dispatch_id on the shipments. Null when any shipment is not free (nothing written). */
  createDispatch(row: NewDispatch, shipmentIds: readonly string[]): Promise<{ dispatch: DispatchRow; shipments: ShipmentRow[] } | null>
  /** state in `from` (and the columns of `args.expect` as given) -> args.to, token, lease, attempts + 1, the patch, updated_at = now(). Null when another process won or the row changed meanwhile. */
  claimDispatch(id: string, from: readonly DispatchState[], args: DispatchClaimArgs): Promise<DispatchRow | null>
  /** Only the owner: state in DISPATCH_CLAIMED_STATES and claim_token = token. Clears token and lease; `unsent` undoes the count of the claim. */
  finishDispatch(id: string, token: string, patch: DispatchPatch & { state: DispatchState }, options?: FinishOptions): Promise<DispatchRow | null>
  /** state in `from` and, when expect.plan_hash is given, plan_hash "is not distinct from" it -> patch, updated_at = now(); never touches a claimed row. A local withdraw always passes the plan_hash it read: the state does not change there, so only the hash stops a second concurrent withdraw. */
  transitionDispatch(
    id: string,
    from: readonly DispatchState[],
    patch: DispatchPatch,
    expect?: { plan_hash?: string | null; error_code?: string | null; order_number?: string | null; check_sum_set?: boolean },
  ): Promise<DispatchRow | null>
  /** DS8: printing past its lease -> ordered when ordered_at is set (a reprint from ordered), else printed when protocol_at is set, else pending; ordering -> unknown; updating -> ordered. error_code as the claim set it, token and lease cleared. Returns the rows changed. */
  expireDispatchLeases(mode: DpdMode, now: Date): Promise<DispatchRow[]>
  /** printing past its lease with protocol_at null and ordered_at null -> claim_token = args.token, lease_until = args.leaseUntil, state stays printing, error and error_code kept, attempts unchanged, updated_at = now(). One statement; the pass clears the markers while it holds the rows, then finishDispatch(id, args.token, { state: "pending", ... }). Returns the rows taken. */
  claimExpiredFirstPrints(mode: DpdMode, now: Date, args: { token: string; leaseUntil: Date }): Promise<DispatchRow[]>
  /** dispatch_id = null, handed_over_at = null on the shipments of the dispatch (all, or `ids`). Returns the rows changed. */
  releaseShipments(dispatchId: string, ids: readonly string[] | null): Promise<ShipmentRow[]>
  /** handed_over_at = at where dispatch_id = dispatchId and handed_over_at is null. */
  markHandedOver(dispatchId: string, at: Date): Promise<ShipmentRow[]>
  /** open: not canceled; attention: dispatchNeedsAttention (unknown, or ordered with an error_code of DISPATCH_ATTENTION_CODES, bound as a list). An ordered row without a check_sum is not attention. */
  dispatchCounts(mode: DpdMode): Promise<{ open: number; attention: number }>
  /** One page, newest first, and the count of the whole list. */
  listDispatches(args: DispatchListArgs): Promise<{ rows: DispatchRow[]; count: number }>
}

/** The smallest piece of Knex the store needs. */
export type SqlRunner = {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export const SHIPMENT_TABLE = "dpd_shipment"
export const EVENT_TABLE = "dpd_event"
export const SETTING_TABLE = "dpd_setting"
export const DISPATCH_TABLE = "dpd_dispatch"

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

/** Columns a dispatch patch may set. Only these names ever reach the SQL text. */
export const DISPATCH_PATCHABLE_COLUMNS: readonly string[] = [
  "state",
  "location_id",
  "sender",
  "params",
  "problems",
  "plan_hash",
  "shipment_ids",
  "protocols",
  "protocol_at",
  "pickup_date",
  "pickup_time_from",
  "pickup_time_to",
  "order_type",
  "order_number",
  "check_sum",
  "ordered_at",
  "error",
  "error_code",
  "updated_by",
]

/** Written as jsonb: sender, params, problems, shipment_ids, protocols. */
export const DISPATCH_JSON_COLUMNS: readonly string[] = ["sender", "params", "problems", "shipment_ids", "protocols"]

/**
 * The Panel group of a row in SQL, branch for branch the rule of groupOf in
 * contract.ts (the admin and the memory store use groupOf itself):
 * canceled, skipped or excluded first, then returns, then the refusals and unclear
 * answers, then the stage DPD reports, then the label and the handover.
 */
export const GROUP_SQL = `case
  when "state" in ('canceled', 'skipped', 'excluded') then 'canceled'
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

/** The conditions of a TransitionExpect, each `and ...`, with its bindings; empty without one. */
export function expectClause(expect?: TransitionExpect): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  if (expect && "pudo_id" in expect && expect.pudo_id !== undefined) {
    parts.push(` and "pudo_id" is not distinct from ?`)
    bindings.push(expect.pudo_id)
  }
  if (expect && "boxes" in expect && expect.boxes !== undefined) {
    parts.push(` and "boxes" is not distinct from ?::jsonb`)
    bindings.push(expect.boxes === null ? null : JSON.stringify(expect.boxes))
  }
  if (expect && "dispatch_id" in expect && expect.dispatch_id !== undefined) {
    parts.push(` and "dispatch_id" is not distinct from ?`)
    bindings.push(expect.dispatch_id)
  }
  return { sql: parts.join(""), bindings }
}

const CLAIMED: readonly string[] = DISPATCH_CLAIMED_STATES
/** The claimed states as SQL literals: constants only, never input. */
const CLAIMED_SQL = DISPATCH_CLAIMED_STATES.map((s) => `'${s}'`).join(", ")

/** The `set` list of a dispatch patch (DISPATCH_PATCHABLE_COLUMNS, jsonb for DISPATCH_JSON_COLUMNS); updated_at is now(), or `updatedAt`. */
export function dispatchSetClause(patch: DispatchPatch, updatedAt?: Date | null): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  const values: Record<string, unknown> = { ...patch }
  for (const column of DISPATCH_PATCHABLE_COLUMNS) {
    if (!(column in values) || values[column] === undefined) continue
    const v = values[column]
    if (DISPATCH_JSON_COLUMNS.includes(column)) {
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

/**
 * A dispatch write that binds the courier checkSum: a database error must not carry it.
 * Knex puts the statement with its bindings into the message (compileSqlOnError), and the
 * routes log the stack, so the error becomes a fixed sentence with the pg error code only:
 * no statement, no bindings, no cause.
 */
export async function withoutCheckSum<T>(patch: DispatchPatch, write: () => Promise<T>): Promise<T> {
  if (typeof patch.check_sum !== "string" || patch.check_sum === "") return write()
  try {
    return await write()
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined
    const suffix = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? ` (${code})` : ""
    throw new Error(`The dpd_dispatch update failed${suffix}; the statement is not shown, it carries the courier checkSum.`)
  }
}

export type DispatchExpect = { plan_hash?: string | null; error_code?: string | null; order_number?: string | null; check_sum_set?: boolean }

/** The conditions of transitionDispatch (E1, O19): "is not distinct from" for the values, presence only for the checkSum (its value is never bound). */
export function dispatchExpectClause(expect?: DispatchExpect): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  for (const column of ["plan_hash", "error_code", "order_number"] as const) {
    const v = expect?.[column]
    if (v === undefined) continue
    parts.push(` and "${column}" is not distinct from ?`)
    bindings.push(v)
  }
  if (expect?.check_sum_set !== undefined) parts.push(expect.check_sum_set ? ` and "check_sum" is not null` : ` and "check_sum" is null`)
  return { sql: parts.join(""), bindings }
}

/** dispatchNeedsAttention in SQL: unknown, or ordered with an error_code of DISPATCH_ATTENTION_CODES (bound as a list, O17). */
export function attentionClause(): { sql: string; bindings: unknown[] } {
  const codes = [...DISPATCH_ATTENTION_CODES]
  if (codes.length === 0) return { sql: `"state" = 'unknown'`, bindings: [] }
  return { sql: `("state" = 'unknown' or ("state" = 'ordered' and "error_code" in (${codes.map(() => "?").join(", ")})))`, bindings: codes }
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
      const guard = expectClause(args.expect)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set ${set.sql}, "state" = ?, "claim_token" = ?, "lease_until" = ?, "attempts" = "attempts" + 1
         where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null${guard.sql}
         returning *`,
        [...set.bindings, args.to, args.token, args.leaseUntil, id, ...from, ...guard.bindings],
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

    async transition(id, from, patch, expect) {
      if (from.length === 0) return null
      const set = setClause(patch)
      const guard = expectClause(expect)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set ${set.sql}
         where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null${guard.sql}
         returning *`,
        [...set.bindings, id, ...from, ...guard.bindings],
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
    // stage 4 (core): the dispatch statements
    async createDispatch(row, shipmentIds) {
      const ids = [...new Set(shipmentIds)]
      if (ids.length === 0) return null
      const placeholders = ids.map(() => "?").join(", ")
      /*
       * One statement: the free shipments are locked, the dispatch is
       * inserted only when every id is free, and the shipments are pinned to
       * it. A shipment taken meanwhile fails the count (the lock waits, then
       * the row no longer matches), so nothing is written at all.
       */
      const result = await sql.raw(
        `with "picked" as (
           select "id" from "${SHIPMENT_TABLE}"
           where "id" in (${placeholders}) and "mode" = ? and "kind" = 'outbound' and "state" = 'labeled'
             and ("session_type" is null or "session_type" = 'DOMESTIC')
             and "dispatch_id" is null and "handed_over_at" is null and "deleted_at" is null
           for update
         ), "created" as (
           insert into "${DISPATCH_TABLE}" ("id", "mode", "state", "location_id", "sender", "params", "problems", "plan_hash", "shipment_ids",
             "order_type", "attempts", "created_by", "created_at", "updated_at")
           select ?, ?, 'pending', ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, 0, ?, now(), now()
           where (select count(*) from "picked") = ?
           returning *
         ), "pinned" as (
           update "${SHIPMENT_TABLE}" set "dispatch_id" = (select "id" from "created"), "updated_at" = now()
           where "id" in (select "id" from "picked") and exists (select 1 from "created")
           returning *
         )
         select (select row_to_json("created") from "created") as "dispatch",
                (select coalesce(json_agg("pinned"), '[]'::json) from "pinned") as "shipments"`,
        [
          ...ids,
          row.mode,
          newId("dpddsp"),
          row.mode,
          row.location_id,
          json(row.sender),
          json(row.params),
          json(row.problems),
          row.plan_hash,
          JSON.stringify(ids),
          row.order_type,
          row.created_by,
          ids.length,
        ],
      )
      const first = rowsOf<{ dispatch: DispatchRow | null; shipments: ShipmentRow[] | null }>(result)[0]
      if (!first?.dispatch) return null
      return { dispatch: first.dispatch, shipments: Array.isArray(first.shipments) ? first.shipments : [] }
    },

    async claimDispatch(id, from, args) {
      const states = from.filter((s) => !CLAIMED.includes(s))
      if (states.length === 0) return null
      const { state: _ignored, ...patch } = args.patch
      const set = dispatchSetClause(patch)
      const guard = dispatchExpectClause(args.expect)
      const placeholders = states.map(() => "?").join(", ")
      const result = await withoutCheckSum(patch, () =>
        sql.raw(
          `update "${DISPATCH_TABLE}" set ${set.sql}, "state" = ?, "claim_token" = ?, "lease_until" = ?, "attempts" = "attempts" + 1
           where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null${guard.sql}
           returning *`,
          [...set.bindings, args.to, args.token, args.leaseUntil, id, ...states, ...guard.bindings],
        ),
      )
      return rowsOf<DispatchRow>(result)[0] ?? null
    },

    async finishDispatch(id, token, patch, options) {
      const set = dispatchSetClause(patch, options?.unsent?.updatedAt)
      const uncount = options?.unsent ? `, "attempts" = greatest("attempts" - 1, 0)` : ""
      const result = await withoutCheckSum(patch, () =>
        sql.raw(
          `update "${DISPATCH_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null${uncount}
           where "id" = ? and "state" in (${CLAIMED_SQL}) and "claim_token" = ? and "deleted_at" is null
           returning *`,
          [...set.bindings, id, token],
        ),
      )
      return rowsOf<DispatchRow>(result)[0] ?? null
    },

    async transitionDispatch(id, from, patch, expect) {
      /* Never a claimed row: its owner writes the result (finishDispatch). */
      const states = from.filter((s) => !CLAIMED.includes(s))
      if (states.length === 0) return null
      const set = dispatchSetClause(patch)
      const guard = dispatchExpectClause(expect)
      const placeholders = states.map(() => "?").join(", ")
      const result = await withoutCheckSum(patch, () =>
        sql.raw(
          `update "${DISPATCH_TABLE}" set ${set.sql}
           where "id" = ? and "state" in (${placeholders}) and "deleted_at" is null${guard.sql}
           returning *`,
          [...set.bindings, id, ...states, ...guard.bindings],
        ),
      )
      return rowsOf<DispatchRow>(result)[0] ?? null
    },

    async expireDispatchLeases(mode, now) {
      /* One statement per claimed state; error and error_code stay as the claim set them (P5). */
      const printing = await sql.raw(
        `update "${DISPATCH_TABLE}" set "state" = case
             when "ordered_at" is not null then 'ordered'
             when "protocol_at" is not null then 'printed'
             else 'pending'
           end,
           "claim_token" = null, "lease_until" = null, "updated_at" = now()
         where "mode" = ? and "state" = 'printing' and "lease_until" < ? and "deleted_at" is null
         returning *`,
        [mode, now],
      )
      const ordering = await sql.raw(
        `update "${DISPATCH_TABLE}" set "state" = 'unknown', "claim_token" = null, "lease_until" = null, "updated_at" = now()
         where "mode" = ? and "state" = 'ordering' and "lease_until" < ? and "deleted_at" is null
         returning *`,
        [mode, now],
      )
      const updating = await sql.raw(
        `update "${DISPATCH_TABLE}" set "state" = 'ordered', "claim_token" = null, "lease_until" = null, "updated_at" = now()
         where "mode" = ? and "state" = 'updating' and "lease_until" < ? and "deleted_at" is null
         returning *`,
        [mode, now],
      )
      return [...rowsOf<DispatchRow>(printing), ...rowsOf<DispatchRow>(ordering), ...rowsOf<DispatchRow>(updating)]
    },

    async claimExpiredFirstPrints(mode, now, args) {
      const result = await sql.raw(
        `update "${DISPATCH_TABLE}" set "claim_token" = ?, "lease_until" = ?, "updated_at" = now()
         where "mode" = ? and "state" = 'printing' and "lease_until" < ? and "protocol_at" is null and "ordered_at" is null
           and "deleted_at" is null
         returning *`,
        [args.token, args.leaseUntil, mode, now],
      )
      return rowsOf<DispatchRow>(result)
    },

    async releaseShipments(dispatchId, ids) {
      if (ids !== null && ids.length === 0) return []
      const only = ids === null ? "" : ` and "id" in (${ids.map(() => "?").join(", ")})`
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "dispatch_id" = null, "handed_over_at" = null, "updated_at" = now()
         where "dispatch_id" = ?${only} and "deleted_at" is null
         returning *`,
        [dispatchId, ...(ids ?? [])],
      )
      return rowsOf<ShipmentRow>(result)
    },

    async markHandedOver(dispatchId, at) {
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "handed_over_at" = ?, "updated_at" = now()
         where "dispatch_id" = ? and "handed_over_at" is null and "deleted_at" is null
         returning *`,
        [at, dispatchId],
      )
      return rowsOf<ShipmentRow>(result)
    },

    async dispatchCounts(mode) {
      const attention = attentionClause()
      const result = await sql.raw(
        `select count(*) filter (where "state" <> 'canceled')::int as "open",
                count(*) filter (where ${attention.sql})::int as "attention"
         from "${DISPATCH_TABLE}"
         where "mode" = ? and "deleted_at" is null`,
        [...attention.bindings, mode],
      )
      const r = rowsOf<{ open: number | string | null; attention: number | string | null }>(result)[0]
      return { open: Number(r?.open ?? 0) || 0, attention: Number(r?.attention ?? 0) || 0 }
    },

    async listDispatches(args) {
      const where: string[] = [`"mode" = ?`, `"deleted_at" is null`]
      const bindings: unknown[] = [args.mode]
      if (args.filter === "open") where.push(`"state" <> 'canceled'`)
      else if (args.filter === "attention") {
        const attention = attentionClause()
        where.push(attention.sql)
        bindings.push(...attention.bindings)
      }
      const condition = where.join(" and ")
      const rows = await sql.raw(
        `select * from "${DISPATCH_TABLE}" where ${condition}
         order by "created_at" desc, "id" desc
         limit ? offset ?`,
        [...bindings, args.limit, args.offset],
      )
      const total = await sql.raw(`select count(*)::int as "count" from "${DISPATCH_TABLE}" where ${condition}`, bindings)
      const count = Number(rowsOf<{ count: number | string }>(total)[0]?.count ?? 0) || 0
      return { rows: rowsOf<DispatchRow>(rows), count }
    },
  }
}
