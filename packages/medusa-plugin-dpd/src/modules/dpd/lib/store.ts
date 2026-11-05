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
 *
 * The statuses (stage 5) claim the same way, by last_checked_at:
 *
 *   pickDueForStatus  rows due for a question to DPD and the writer backlog
 *                     in one statement (for update skip locked), with the
 *                     last_checked_at from before the claim (E3)
 *   unclaimStatus     that value back on the rows a pass did not reach,
 *                     only while the claim is still theirs
 *   applyTracking     the fold, only while the row holds what it read (6.6)
 *   claimMark         the writer marks: only the first caller sets one; a
 *   releaseMark       failed write clears it with its error; a write left
 *   notePendingMark   pending leaves a note
 */

import { DISPATCH_ATTENTION_CODES, SHIPMENT_GROUPS, type DispatchFilter, type ShipmentFilter, type ShipmentGroup } from "./contract"
import { DISPATCH_CLAIMED_STATES, STATUS_MAX_AGE_DAYS, type DispatchState, type DpdMode } from "./constants"
import type { DispatchRow, EventRow, SettingRow, ShipmentRow } from "./dto"
import { clip, jsonText } from "./text"

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
    | "tracking"
    | "status_at"
    | "status_writer_error"
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
  /** Only rows with status_writer_error set (GET /admin/dpd/shipments?writer=failed). */
  writerFailed?: boolean
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
  /** Compared with "is not distinct from"; absent: not checked (R14: excludeShipment passes the stage it read, so a pass that moved the stage in between wins). */
  stage?: string | null
  /** Compared as jsonb, null matches null. excludeShipment passes the tracking it read: a pass may add possession and keep the stage (problem, rule 2), and isPickedUp reads the tracking. */
  tracking?: unknown
  /** Compared with "is not distinct from" (null matches an unmarked row): the other input of isPickedUp. */
  shipped_marked_at?: Date | string | null
}

/** pickDueForStatus (DS6). `now` is the claim time written to last_checked_at. */
export type DueArgs = {
  mode: DpdMode
  now: Date
  /** The row limit of each part of the claim (status rows, writer backlog rows). */
  limit: number
  maxAgeDays: number
  spacingMin: number
  spacingBeforeHandoverMin: number
  /** The fulfillmentStatus writer is armed in this mode and the mode is not demo: also claim writer backlog rows (E4, E24, 6.19). */
  writerBacklog: boolean
  /** WRITER_MARK_STALE_MS: a writer mark older than this may be stale (path c of 6.19). */
  markStaleMs: number
}

/**
 * A claimed row with its last_checked_at from before the claim (E3): the pass
 * works in this order and gives it back to the rows it did not reach.
 * due_kind "status": due by DS6 (ask DPD); "writer": a writer backlog row
 * (stage delivered, 6.19), only runStatusWriter, no DPD call.
 */
export type DueRow = ShipmentRow & { prev_checked_at: Date | string | null; due_kind: "status" | "writer" }

/** What applyTracking writes (6.6). waybills and boxes only on a repin; last_checked_at only from a manual refresh. */
export type TrackingWrite = {
  tracking: unknown
  stage: string | null
  status: string | null
  status_at: Date | null
  waybills?: string[]
  boxes?: unknown
  last_checked_at?: Date
}
/** The values the fold read; the write lands only while all six still hold and the row is still created or labeled (E6). handed_over_at because rowStage reads it (O17): a withdrawal or a handover after the read makes the fold stale. */
export type TrackingExpect = { stage: string | null; status: string | null; status_at: Date | string | null; tracking: unknown; waybills: unknown; handed_over_at: Date | string | null }

export type MarkColumn = "shipped_marked_at" | "delivered_marked_at"

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
  // stage 5: statuses
  /** Claims due rows: last_checked_at = now on up to `limit` status rows and, with writerBacklog, up to `limit` writer backlog rows (for update skip locked), returning them with the value before the claim and due_kind. */
  pickDueForStatus(args: DueArgs): Promise<DueRow[]>
  /** Rows of a claim the pass did not reach get prev_checked_at back, only while last_checked_at still equals claimedAt (E3); the number restored. */
  unclaimStatus(rows: ReadonlyArray<Pick<DueRow, "id" | "prev_checked_at">>, claimedAt: Date): Promise<number>
  /** Compare and set of 6.6; null when the row changed since the fold read it. */
  applyTracking(id: string, write: TrackingWrite, expect: TrackingExpect): Promise<ShipmentRow | null>
  /** col = at, status_writer_error = null where col is null; true for the winner. */
  claimMark(id: string, column: MarkColumn, at: Date): Promise<boolean>
  /** col = null, status_writer_error = error where col still equals markedAt (the claim of the caller, or the mark it found stale); true when it released. A fresh claim of another caller is never released. */
  releaseMark(id: string, column: MarkColumn, error: string, markedAt: Date): Promise<boolean>
  /** status_writer_error = error where col is null and status_writer_error is null (a write left pending on a row no longer due, E24); true when it wrote. */
  notePendingMark(id: string, column: MarkColumn, error: string): Promise<boolean>
  /** Deletes status events older than `before` of rows no longer asked for (DS17); the number deleted. */
  pruneStatusEvents(mode: DpdMode, before: Date, now: Date): Promise<number>
  /** Rows of one mode with status_writer_error set. */
  statusCounts(mode: DpdMode): Promise<{ writerErrors: number }>
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
  "tracking",
  "status_at",
  "status_writer_error",
]

const JSON_COLUMNS: ReadonlySet<string> = new Set(["references", "boxes", "waybills", "problems", "tracking"])

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
 * returnDone of tracking.ts in SQL (E61): STATUS_MAX_AGE_DAYS since the
 * handover (or the row), or a live return entry of the tracking (no
 * supersededBy, its waybill in waybills) delivered. No placeholder, so it
 * goes into GROUP_SQL as it is.
 */
export const RETURN_DONE_SQL = `(coalesce("handed_over_at", "created_at") <= now() - interval '${STATUS_MAX_AGE_DAYS} days' or exists (select 1 from jsonb_array_elements(case when jsonb_typeof("tracking") = 'array' then "tracking" else '[]'::jsonb end) as "r" where "r"->>'role' = 'return' and "r"->>'stage' = 'delivered' and coalesce("r"->>'supersededBy', '') = '' and jsonb_typeof("waybills") = 'array' and "waybills" @> jsonb_build_array("r"->>'waybill')))`

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
  when "stage" = 'returned' and ${RETURN_DONE_SQL} then 'returns'
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
      bindings.push(v === null ? null : jsonText(v))
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
    bindings.push(expect.boxes === null ? null : jsonText(expect.boxes))
  }
  if (expect && "dispatch_id" in expect && expect.dispatch_id !== undefined) {
    parts.push(` and "dispatch_id" is not distinct from ?`)
    bindings.push(expect.dispatch_id)
  }
  if (expect && "stage" in expect && expect.stage !== undefined) {
    parts.push(` and "stage" is not distinct from ?`)
    bindings.push(expect.stage)
  }
  if (expect && "tracking" in expect && expect.tracking !== undefined) {
    parts.push(` and "tracking" is not distinct from ?::jsonb`)
    bindings.push(expect.tracking === null ? null : jsonText(expect.tracking))
  }
  if (expect && "shipped_marked_at" in expect && expect.shipped_marked_at !== undefined) {
    parts.push(` and "shipped_marked_at" is not distinct from ?::timestamptz`)
    bindings.push(expect.shipped_marked_at)
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
      bindings.push(v === null ? null : jsonText(v))
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

/**
 * Every waybill the tracking ever held, the repinned ones too: a repin swaps the number in waybills
 * in place (O8), the label and the handover protocol still carry the old one. Only the waybill field,
 * so no description matches; a tracking that is no array matches nothing.
 */
const TRACKING_WAYBILL_SQL = `exists (select 1 from jsonb_array_elements(case when jsonb_typeof("tracking") = 'array' then "tracking" else '[]'::jsonb end) as "e" where "e"->>'waybill' ilike ?)`

/** The search condition and its bindings, or null for an empty search. */
export function searchClause(q: string | null | undefined): { sql: string; bindings: unknown[] } | null {
  const s = searchText(q)
  if (!s) return null
  const parts = [`"order_id" = ?`, `"fulfillment_id" = ?`, `"pudo_id" ilike ?`, `"waybills"::text ilike ?`, TRACKING_WAYBILL_SQL, `"reference" ilike ?`]
  const bindings: unknown[] = [s, s, like(s), like(s), like(s), like(s)]
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

const json = (v: unknown) => (v === null || v === undefined ? null : jsonText(v))

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
/** The longest status_writer_error kept. */
const WRITER_ERROR_MAX = 500

/** A writer mark column for the SQL text: only the two names of MarkColumn ever reach it. */
function markColumn(column: MarkColumn): MarkColumn {
  if (column !== "shipped_marked_at" && column !== "delivered_marked_at") throw new Error("Unknown writer mark column.")
  return column
}

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
          event.message ? clip(event.message, 2000) : null,
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
      if (args.writerFailed) where.push(`"status_writer_error" is not null`)
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
          jsonText(ids),
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
      /* ready without a handover would lie in the Panel and rowStage never moves a stage back, so ready (and null, E27) becomes preparing (O41). */
      if (ids !== null && ids.length === 0) return []
      const only = ids === null ? "" : ` and "id" in (${ids.map(() => "?").join(", ")})`
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "dispatch_id" = null, "handed_over_at" = null,
           "stage" = case when "stage" is null or "stage" = 'ready' then 'preparing' else "stage" end, "updated_at" = now()
         where "dispatch_id" = ?${only} and "deleted_at" is null
         returning *`,
        [dispatchId, ...(ids ?? [])],
      )
      return rowsOf<ShipmentRow>(result)
    },

    async markHandedOver(dispatchId, at) {
      /* The handover is the ready stage (DS12); a stage DPD already reported stays. */
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "handed_over_at" = ?,
           "stage" = case when "stage" is null or "stage" = 'preparing' then 'ready' else "stage" end, "updated_at" = now()
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
    // stage 5 (core): the status statements
    async pickDueForStatus(args) {
      const at = (ms: number) => new Date(args.now.getTime() - ms)
      const oldest = at(args.maxAgeDays * DAY_MS)
      const spacing = at(args.spacingMin * MINUTE_MS)
      const stale = at(args.markStaleMs)
      /*
       * One claim, two parts (E4, E24, O49): rows to ask DPD about, and the
       * writer backlog of delivered rows. The parts never overlap (the stage
       * tells them apart) and each has its own limit, so the backlog never
       * pushes the questions to DPD out. The CTEs read the rows before the
       * update, so prev_checked_at is the value before the claim (E3).
       */
      const result = await sql.raw(
        `with "status_due" as (
           select "id", "last_checked_at" as "prev_checked_at", 'status' as "due_kind" from "${SHIPMENT_TABLE}"
           where "mode" = ? and "deleted_at" is null and "kind" = 'outbound'
             and "state" in ('created', 'labeled')
             and jsonb_typeof("waybills") = 'array' and jsonb_array_length("waybills") > 0
             and coalesce("stage", '') not in ('delivered', 'canceled')
             and not ("mode" = 'demo' and "fulfillment_id" is null)
             and coalesce("handed_over_at", "created_at") > ?
             and ("last_checked_at" is null or "last_checked_at" <= case
                   when "handed_over_at" is not null or coalesce("stage", '') in ('in_transit', 'in_point', 'problem', 'returned') then ?::timestamptz
                   else ?::timestamptz end)
           order by "last_checked_at" asc nulls first, "id" asc
           limit ?
           for update skip locked
         ), "writer_due" as (
           select "id", "last_checked_at" as "prev_checked_at", 'writer' as "due_kind" from "${SHIPMENT_TABLE}"
           where ?::boolean and "mode" = ? and "mode" <> 'demo' and "deleted_at" is null and "kind" = 'outbound'
             and "state" in ('created', 'labeled')
             and "fulfillment_id" is not null and "order_id" is not null
             and "stage" = 'delivered'
             and coalesce("handed_over_at", "created_at") > ?
             and ("last_checked_at" is null or "last_checked_at" <= ?::timestamptz)
             and (
               ("shipped_marked_at" is null and exists (select 1 from jsonb_array_elements(case when jsonb_typeof("tracking") = 'array' then "tracking" else '[]'::jsonb end) "e" where "e"->>'possession' = 'true'))
               or "delivered_marked_at" is null
               or ("status_writer_error" is null and (
                     ("shipped_marked_at" <= ?::timestamptz and ("last_checked_at" is null or "last_checked_at" < "shipped_marked_at" + (?::int * interval '1 millisecond')))
                  or ("delivered_marked_at" <= ?::timestamptz and ("last_checked_at" is null or "last_checked_at" < "delivered_marked_at" + (?::int * interval '1 millisecond')))))
             )
           order by "last_checked_at" asc nulls first, "id" asc
           limit ?
           for update skip locked
         )
         update "${SHIPMENT_TABLE}" as "s" set "last_checked_at" = ?, "updated_at" = now()
         from (select * from "status_due" union all select * from "writer_due") as "due"
         where "s"."id" = "due"."id"
         returning "s".*, "due"."prev_checked_at", "due"."due_kind"`,
        [
          args.mode,
          oldest,
          spacing,
          at(args.spacingBeforeHandoverMin * MINUTE_MS),
          args.limit,
          args.writerBacklog,
          args.mode,
          oldest,
          spacing,
          stale,
          args.markStaleMs,
          stale,
          args.markStaleMs,
          args.limit,
          args.now,
        ],
      )
      return rowsOf<DueRow>(result)
    },

    async unclaimStatus(rows, claimedAt) {
      /* One row at a time: only while last_checked_at is still the claim, so a later write (a manual refresh, 6.12) stays. */
      let restored = 0
      for (const row of rows) {
        const result = await sql.raw(
          `update "${SHIPMENT_TABLE}" set "last_checked_at" = ?, "updated_at" = now()
           where "id" = ? and "last_checked_at" = ? and "deleted_at" is null
           returning "id"`,
          [row.prev_checked_at ?? null, row.id, claimedAt],
        )
        restored += rowsOf(result).length
      }
      return restored
    },

    async applyTracking(id, write, expect) {
      const parts = [`"tracking" = ?::jsonb`, `"stage" = ?`, `"status" = ?`, `"status_at" = ?`]
      const bindings: unknown[] = [json(write.tracking), write.stage, write.status, write.status_at]
      if (write.waybills !== undefined) {
        parts.push(`"waybills" = ?::jsonb`)
        bindings.push(json(write.waybills))
      }
      if (write.boxes !== undefined) {
        parts.push(`"boxes" = ?::jsonb`)
        bindings.push(json(write.boxes))
      }
      if (write.last_checked_at !== undefined) {
        parts.push(`"last_checked_at" = ?`)
        bindings.push(write.last_checked_at)
      }
      /*
       * Compare and set (6.6): the write lands only while the row holds what
       * the fold read. coalesce with '' because the read carries null for a
       * row without a stage or status, and '' = NULL is never true (E5); the
       * waybills and the state keep an old pass off new waybills (E6, O50);
       * handed_over_at keeps a fold that read the row before a withdrawal or
       * a handover from writing ready or preparing on it (O17, E27).
       */
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set ${parts.join(", ")}, "updated_at" = now()
         where "id" = ? and "deleted_at" is null
           and coalesce("stage", '') = ? and coalesce("status", '') = ?
           and "status_at" is not distinct from ?
           and "tracking" is not distinct from ?::jsonb
           and "waybills" is not distinct from ?::jsonb
           and "handed_over_at" is not distinct from ?
           and "state" in ('created', 'labeled')
         returning *`,
        [...bindings, id, expect.stage ?? "", expect.status ?? "", expect.status_at, json(expect.tracking), json(expect.waybills), expect.handed_over_at],
      )
      return rowsOf<ShipmentRow>(result)[0] ?? null
    },

    async claimMark(id, column, at) {
      const col = markColumn(column)
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "${col}" = ?, "status_writer_error" = null, "updated_at" = now()
         where "id" = ? and "${col}" is null and "deleted_at" is null
         returning "id"`,
        [at, id],
      )
      return rowsOf(result).length > 0
    },

    async releaseMark(id, column, error, markedAt) {
      const col = markColumn(column)
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "${col}" = null, "status_writer_error" = ?, "updated_at" = now()
         where "id" = ? and "${col}" = ? and "deleted_at" is null
         returning "id"`,
        [clip(String(error), WRITER_ERROR_MAX), id, markedAt],
      )
      return rowsOf(result).length > 0
    },

    async notePendingMark(id, column, error) {
      /* Never over a workflow error (releaseMark) nor a mark of another process; a won claimMark clears the note like any error. */
      const col = markColumn(column)
      const result = await sql.raw(
        `update "${SHIPMENT_TABLE}" set "status_writer_error" = ?, "updated_at" = now()
         where "id" = ? and "${col}" is null and "status_writer_error" is null and "deleted_at" is null
         returning "id"`,
        [clip(String(error), WRITER_ERROR_MAX), id],
      )
      return rowsOf(result).length > 0
    },

    async pruneStatusEvents(mode, before, now) {
      /* Status events only, of rows no longer asked for (DS6 and 6.5, DS17); action and run events stay. */
      const result = await sql.raw(
        `with "deleted" as (
           delete from "${EVENT_TABLE}"
           where "kind" = 'status' and "mode" = ? and "occurred_at" < ?
             and "shipment_id" in (
               select "id" from "${SHIPMENT_TABLE}"
               where "mode" = ? and (
                 "deleted_at" is not null or "kind" <> 'outbound' or "state" not in ('created', 'labeled')
                 or coalesce("stage", '') in ('delivered', 'canceled')
                 or coalesce("handed_over_at", "created_at") <= ?
                 or ("stage" = 'returned' and exists (
                   select 1 from jsonb_array_elements(case when jsonb_typeof("tracking") = 'array' then "tracking" else '[]'::jsonb end) "e"
                   where "e"->>'role' = 'return' and "e"->>'stage' = 'delivered' and "e"->>'supersededBy' is null))
               )
             )
           returning 1
         )
         select count(*)::int as "count" from "deleted"`,
        [mode, before, mode, new Date(now.getTime() - STATUS_MAX_AGE_DAYS * DAY_MS)],
      )
      return Number(rowsOf<{ count: number | string }>(result)[0]?.count ?? 0) || 0
    },

    async statusCounts(mode) {
      const result = await sql.raw(
        `select count(*)::int as "count" from "${SHIPMENT_TABLE}"
         where "mode" = ? and "deleted_at" is null and "status_writer_error" is not null`,
        [mode],
      )
      return { writerErrors: Number(rowsOf<{ count: number | string }>(result)[0]?.count ?? 0) || 0 }
    },
  }
}
