/**
 * THE DATABASE OF THE MODULE, IN SQL. Types and SQL text only: the
 * connection is injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory store of the same rules.
 *
 * WHY SQL FOR EVERYTHING HERE:
 *
 *   - A move must be ONE conditional statement. The generated service
 *     updates "by selector" by listing rows first and updating them by id
 *     afterwards, so a person accepting and the expiry job expiring could
 *     both "win". Here a move is
 *
 *       update "negotiation" set ... where "id" = ? and "status" in (...)
 *
 *     plus its message, in one transaction. Postgres lets exactly one of two
 *     concurrent moves see the old status; the other changes nothing and the
 *     caller answers 409.
 *   - The thread table may be older than this plugin and carry columns the
 *     model does not declare (`target_price` of the app module). `select *`
 *     reads both shapes; a model-driven select would ask for exactly the
 *     declared columns.
 *   - The demo store this plugin comes from broke module services that
 *     called their own generated methods (an entity manager `fork` error);
 *     plain SQL on Medusa's own connection has no such failure mode.
 *
 * Every column a statement writes is whitelisted; values travel as bindings.
 */

import {
  ACTIVE_STATUSES,
  DEMO_ID_PREFIX,
  DRAFT_ORDER_TABLE,
  MESSAGE_TABLE,
  REF_SEQUENCE,
  RUN_TABLE,
  SETTING_TABLE,
  THREAD_TABLE,
  type NegotiationStatus,
} from "./constants"
import type { DraftOrderRow, MessageInsert, MessageRow, RunRow, SettingRow, ThreadInsert, ThreadRow } from "./rows"

/** The smallest piece of Knex the store needs. */
export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
  transaction?<T>(fn: (trx: SqlRunner) => Promise<T>): Promise<T>
}

export function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

/** Runs `fn` in a transaction when the runner has one (Knex), directly otherwise (tests). */
export async function inTransaction<T>(sql: SqlRunner, fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
  return typeof sql.transaction === "function" ? sql.transaction(fn) : fn(sql)
}

const list = (n: number) => Array.from({ length: n }, () => "?").join(", ")

/* ------------------------------------------------------------------ */
/* Threads                                                             */
/* ------------------------------------------------------------------ */

/** Thread columns a move may set. Only these names ever reach the SQL text. */
export const THREAD_PATCHABLE = [
  "status",
  "waiting_for",
  "requested_amount",
  "offered_amount",
  "agreed_amount",
  "price_amount",
  "currency_code",
  "expires_at",
  "closed_at",
  "closed_by",
  "assigned_to",
  "last_activity_at",
] as const

export type ThreadPatch = Partial<Record<(typeof THREAD_PATCHABLE)[number], unknown>>

export function setClause(patch: Record<string, unknown>, columns: readonly string[], jsonColumns: ReadonlySet<string> = new Set()): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  for (const column of columns) {
    if (!(column in patch) || patch[column] === undefined) continue
    const v = patch[column]
    if (jsonColumns.has(column)) {
      parts.push(`"${column}" = ?::jsonb`)
      bindings.push(v === null ? null : JSON.stringify(v))
    } else {
      parts.push(`"${column}" = ?`)
      bindings.push(v)
    }
  }
  return { sql: parts.join(", "), bindings }
}

const THREAD_COLUMNS = [
  "id",
  "ref",
  "status",
  "demo",
  "source",
  "subject",
  "customer_id",
  "product_id",
  "variant_id",
  "cart_id",
  "sku",
  "title",
  "qty",
  "currency_code",
  "requested_amount",
  "offered_amount",
  "agreed_amount",
  "price_amount",
  "list_amount",
  "items",
  "waiting_for",
  "last_activity_at",
  "message_count",
  "expires_at",
  "closed_at",
  "closed_by",
  "assigned_to",
  "metadata",
  "created_at",
  "updated_at",
] as const

const MESSAGE_COLUMNS = ["id", "negotiation_id", "author_type", "author_id", "kind", "body", "amount", "internal", "metadata", "created_at", "updated_at"] as const

function threadValues(t: ThreadInsert): { sql: string; bindings: unknown[] } {
  const json = new Set(["items", "metadata"])
  const placeholders = THREAD_COLUMNS.map((c) => (json.has(c) ? "?::jsonb" : "?")).join(", ")
  const bindings = THREAD_COLUMNS.map((c) => {
    const v = (t as unknown as Record<string, unknown>)[c]
    return json.has(c) ? (v === null || v === undefined ? null : JSON.stringify(v)) : (v ?? null)
  })
  return { sql: `(${placeholders})`, bindings }
}

function messageValues(m: MessageInsert): { sql: string; bindings: unknown[] } {
  return {
    sql: `(?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
    bindings: [m.id, m.negotiation_id, m.author_type, m.author_id, m.kind, m.body, m.amount, m.internal, m.metadata === null ? null : JSON.stringify(m.metadata), m.created_at, m.created_at],
  }
}

const INSERT_THREAD = `insert into "${THREAD_TABLE}" (${THREAD_COLUMNS.map((c) => `"${c}"`).join(", ")}) values `
const INSERT_MESSAGE = `insert into "${MESSAGE_TABLE}" (${MESSAGE_COLUMNS.map((c) => `"${c}"`).join(", ")}) values `

export interface ThreadFilter {
  demo: boolean
  statuses?: readonly NegotiationStatus[] | null
  /** Active threads where the customer moved last. */
  waitingForTeam?: boolean
  customerId?: string | null
  /** A product: its threads, plus older ones that only carry one of its SKUs. */
  product?: { id: string; skus: readonly string[] } | null
  /** Leave the demo story out (the Store API). */
  excludeDemoStory?: boolean
  /** Reference, SKU or title like the phrase, or a customer or product the modules matched. */
  search?: { like: string; customerIds: readonly string[]; productIds: readonly string[] } | null
  /** Least recent activity first (the thread that waits longest); latest first otherwise. */
  oldestFirst?: boolean
  limit: number
  offset: number
}

export interface ActArgs {
  id: string
  demo: boolean
  from: readonly NegotiationStatus[]
  /** The move only happens while these still hold (what the person saw). */
  guard?: { offeredAmount?: number; priceAmount?: number; maxMessages?: number }
  patch: ThreadPatch
  /** The message counts towards `message_count` (public messages do, notes do not). */
  countMessage: boolean
  message: MessageInsert | null
  now: Date
}

export interface StatusCountRow {
  status: string
  count: number
  waiting: number
  from_store: number
}

export interface ThreadStore {
  nextRefNumber(): Promise<number>
  insertThread(thread: ThreadInsert, message: MessageInsert): Promise<{ thread: ThreadRow; message: MessageRow }>
  /** A move: the conditional update and its message, together. Null when the thread is not there, of the other mode, or the move is no longer possible. */
  act(args: ActArgs): Promise<{ thread: ThreadRow; message: MessageRow | null } | null>
  /** Writes the amounts of an app-module row into the new columns, once. */
  materialize(id: string, values: { currency_code: string | null; requested_amount: number | null; offered_amount: number | null; agreed_amount: number | null; price_amount: number | null }): Promise<void>
  getThread(id: string): Promise<ThreadRow | null>
  listMessages(threadId: string, includeInternal: boolean): Promise<MessageRow[]>
  /** The last public message of each thread. */
  lastMessages(threadIds: readonly string[]): Promise<MessageRow[]>
  listThreads(filter: ThreadFilter): Promise<{ rows: ThreadRow[]; count: number }>
  statusCounts(demo: boolean): Promise<StatusCountRow[]>
  activeThreads(demo: boolean, limit: number): Promise<ThreadRow[]>
  acceptedSince(demo: boolean, since: Date): Promise<ThreadRow[]>
  activeForCustomer(customerId: string, demo: boolean): Promise<ThreadRow[]>
  /** Closes due threads (a batch) and stores their system message, in one transaction. */
  expireDue(args: {
    demo: boolean
    now: Date
    cutoff: Date | null
    limit: number
    message: (row: ThreadRow) => MessageInsert
  }): Promise<Array<{ thread: ThreadRow; previousStatus: string | null; message: MessageRow | null }>>
  /** Replaces the demo story: its old threads, messages and draft records out, the new ones in. */
  replaceDemoStory(threads: readonly ThreadInsert[], messages: readonly MessageInsert[]): Promise<void>
  countDemoStory(): Promise<number>
}

function threadWhere(f: ThreadFilter): { sql: string; bindings: unknown[] } {
  const parts: string[] = [`"deleted_at" is null`, `"demo" = ?`]
  const bindings: unknown[] = [f.demo]
  if (f.statuses && f.statuses.length > 0) {
    parts.push(`"status" in (${list(f.statuses.length)})`)
    bindings.push(...f.statuses)
  }
  if (f.waitingForTeam) {
    parts.push(`"waiting_for" = 'team' and "status" in (${list(ACTIVE_STATUSES.length)})`)
    bindings.push(...ACTIVE_STATUSES)
  }
  if (f.customerId) {
    parts.push(`"customer_id" = ?`)
    bindings.push(f.customerId)
  }
  if (f.product) {
    if (f.product.skus.length > 0) {
      parts.push(`("product_id" = ? or ("product_id" is null and "sku" in (${list(f.product.skus.length)})))`)
      bindings.push(f.product.id, ...f.product.skus)
    } else {
      parts.push(`"product_id" = ?`)
      bindings.push(f.product.id)
    }
  }
  if (f.excludeDemoStory) {
    parts.push(`left("id", ${DEMO_ID_PREFIX.length}) <> ?`)
    bindings.push(DEMO_ID_PREFIX)
  }
  if (f.search) {
    const or: string[] = [`"ref" ilike ?`, `"sku" ilike ?`, `"title" ilike ?`]
    const b: unknown[] = [f.search.like, f.search.like, f.search.like]
    if (f.search.customerIds.length > 0) {
      or.push(`"customer_id" in (${list(f.search.customerIds.length)})`)
      b.push(...f.search.customerIds)
    }
    if (f.search.productIds.length > 0) {
      or.push(`"product_id" in (${list(f.search.productIds.length)})`)
      b.push(...f.search.productIds)
    }
    parts.push(`(${or.join(" or ")})`)
    bindings.push(...b)
  }
  return { sql: parts.join(" and "), bindings }
}

export function createThreadStore(sql: SqlRunner): ThreadStore {
  return {
    async nextRefNumber() {
      const [row] = rowsOf<{ n: string | number }>(await sql.raw(`select nextval('${REF_SEQUENCE}') as "n"`))
      return Number(row?.n ?? 0)
    },

    async insertThread(thread, message) {
      return inTransaction(sql, async (tx) => {
        const t = threadValues(thread)
        const [row] = rowsOf<ThreadRow>(await tx.raw(`${INSERT_THREAD}${t.sql} returning *`, t.bindings))
        const m = messageValues(message)
        const [msg] = rowsOf<MessageRow>(await tx.raw(`${INSERT_MESSAGE}${m.sql} returning *`, m.bindings))
        return { thread: row, message: msg }
      })
    },

    async act(args) {
      return inTransaction(sql, async (tx) => {
        const set = setClause(args.patch as Record<string, unknown>, THREAD_PATCHABLE)
        const assignments = [set.sql, args.countMessage ? `"message_count" = "message_count" + 1` : "", `"updated_at" = ?`].filter(Boolean).join(", ")
        const where: string[] = [`"id" = ?`, `"deleted_at" is null`, `"demo" = ?`, `"status" in (${list(args.from.length)})`]
        const bindings: unknown[] = [...set.bindings, args.now, args.id, args.demo, ...args.from]
        if (args.guard?.offeredAmount !== undefined) {
          where.push(`"offered_amount" = ?`)
          bindings.push(args.guard.offeredAmount)
        }
        if (args.guard?.priceAmount !== undefined) {
          where.push(`"price_amount" = ?`)
          bindings.push(args.guard.priceAmount)
        }
        if (args.guard?.maxMessages !== undefined) {
          where.push(`"message_count" < ?`)
          bindings.push(args.guard.maxMessages)
        }
        if (args.from.length === 0) return null
        const [thread] = rowsOf<ThreadRow>(await tx.raw(`update "${THREAD_TABLE}" set ${assignments} where ${where.join(" and ")} returning *`, bindings))
        if (!thread) return null
        let message: MessageRow | null = null
        if (args.message) {
          const m = messageValues(args.message)
          message = rowsOf<MessageRow>(await tx.raw(`${INSERT_MESSAGE}${m.sql} returning *`, m.bindings))[0] ?? null
        }
        return { thread, message }
      })
    },

    async materialize(id, v) {
      await sql.raw(
        `update "${THREAD_TABLE}" set "currency_code" = coalesce("currency_code", ?), "requested_amount" = ?, "offered_amount" = ?, "agreed_amount" = ?, "price_amount" = ?
         where "id" = ? and "requested_amount" is null and "offered_amount" is null and "agreed_amount" is null and "price_amount" is null`,
        [v.currency_code, v.requested_amount, v.offered_amount, v.agreed_amount, v.price_amount, id],
      )
    },

    async getThread(id) {
      const [row] = rowsOf<ThreadRow>(await sql.raw(`select * from "${THREAD_TABLE}" where "id" = ? and "deleted_at" is null`, [id]))
      return row ?? null
    },

    async listMessages(threadId, includeInternal) {
      return rowsOf<MessageRow>(
        await sql.raw(
          `select * from "${MESSAGE_TABLE}" where "negotiation_id" = ? and "deleted_at" is null${includeInternal ? "" : ` and coalesce("internal", false) = false`}
           order by "created_at" asc, "id" asc`,
          [threadId],
        ),
      )
    },

    async lastMessages(threadIds) {
      if (threadIds.length === 0) return []
      return rowsOf<MessageRow>(
        await sql.raw(
          `select distinct on ("negotiation_id") * from "${MESSAGE_TABLE}"
           where "negotiation_id" in (${list(threadIds.length)}) and "deleted_at" is null and coalesce("internal", false) = false
           order by "negotiation_id", "created_at" desc, "id" desc`,
          [...threadIds],
        ),
      )
    },

    async listThreads(f) {
      const where = threadWhere(f)
      const direction = f.oldestFirst ? "asc" : "desc"
      const rows = rowsOf<ThreadRow>(
        await sql.raw(
          `select * from "${THREAD_TABLE}" where ${where.sql} order by coalesce("last_activity_at", "updated_at") ${direction}, "id" ${direction} limit ? offset ?`,
          [...where.bindings, f.limit, f.offset],
        ),
      )
      const [count] = rowsOf<{ count: number | string }>(await sql.raw(`select count(*)::int as "count" from "${THREAD_TABLE}" where ${where.sql}`, where.bindings))
      return { rows, count: Number(count?.count ?? rows.length) }
    },

    async statusCounts(demo) {
      return rowsOf<StatusCountRow>(
        await sql.raw(
          `select "status", count(*)::int as "count",
                  (count(*) filter (where "waiting_for" = 'team'))::int as "waiting",
                  (count(*) filter (where coalesce("source", 'store') = 'store'))::int as "from_store"
           from "${THREAD_TABLE}" where "deleted_at" is null and "demo" = ? group by "status"`,
          [demo],
        ),
      ).map((r) => ({ status: r.status, count: Number(r.count) || 0, waiting: Number(r.waiting) || 0, from_store: Number(r.from_store) || 0 }))
    },

    async activeThreads(demo, limit) {
      return rowsOf<ThreadRow>(
        await sql.raw(
          `select * from "${THREAD_TABLE}" where "deleted_at" is null and "demo" = ? and "status" in (${list(ACTIVE_STATUSES.length)})
           order by coalesce("last_activity_at", "updated_at") desc limit ?`,
          [demo, ...ACTIVE_STATUSES, limit],
        ),
      )
    },

    async acceptedSince(demo, since) {
      return rowsOf<ThreadRow>(
        await sql.raw(
          `select * from "${THREAD_TABLE}" where "deleted_at" is null and "demo" = ? and "status" = 'accepted' and coalesce("closed_at", "updated_at") >= ?
           order by coalesce("closed_at", "updated_at") desc limit 5000`,
          [demo, since],
        ),
      )
    },

    async activeForCustomer(customerId, demo) {
      return rowsOf<ThreadRow>(
        await sql.raw(
          `select * from "${THREAD_TABLE}" where "deleted_at" is null and "customer_id" = ? and "demo" = ? and "status" in (${list(ACTIVE_STATUSES.length)})`,
          [customerId, demo, ...ACTIVE_STATUSES],
        ),
      )
    },

    async expireDue(args) {
      return inTransaction(sql, async (tx) => {
        const clock = args.cutoff ? ` or ("expires_at" is null and coalesce("last_activity_at", "updated_at") <= ?)` : ""
        const bindings: unknown[] = [args.demo, ...ACTIVE_STATUSES, args.now]
        if (args.cutoff) bindings.push(args.cutoff)
        bindings.push(args.limit, args.now, args.now)
        /* The CTE locks the due rows (skipping rows another pass holds) and keeps their status before the update. */
        const rows = rowsOf<ThreadRow & { previous_status?: string }>(
          await tx.raw(
            `with "due" as (
               select "id", "status" as "previous_status" from "${THREAD_TABLE}"
               where "deleted_at" is null and "demo" = ? and "status" in (${list(ACTIVE_STATUSES.length)})
                 and (("expires_at" is not null and "expires_at" <= ?)${clock})
               order by "id" limit ? for update skip locked
             )
             update "${THREAD_TABLE}" as "n" set "status" = 'expired', "waiting_for" = null, "closed_at" = ?, "closed_by" = 'system',
               "message_count" = "n"."message_count" + 1, "updated_at" = ?
             from "due" where "n"."id" = "due"."id"
             returning "n".*, "due"."previous_status"`,
            bindings,
          ),
        )
        const out: Array<{ thread: ThreadRow; previousStatus: string | null; message: MessageRow | null }> = []
        for (const row of rows) {
          const { previous_status, ...thread } = row
          const m = messageValues(args.message(thread))
          const [message] = rowsOf<MessageRow>(await tx.raw(`${INSERT_MESSAGE}${m.sql} returning *`, m.bindings))
          out.push({ thread, previousStatus: previous_status ?? null, message: message ?? null })
        }
        return out
      })
    },

    async replaceDemoStory(threads, messages) {
      await inTransaction(sql, async (tx) => {
        /* One rebuild at a time across processes. */
        await tx.raw(`select pg_advisory_xact_lock(hashtext('koda.negotiations.demo'))`)
        const prefix = DEMO_ID_PREFIX.length
        await tx.raw(`delete from "${MESSAGE_TABLE}" where left("negotiation_id", ${prefix}) = ?`, [DEMO_ID_PREFIX])
        await tx.raw(`delete from "${DRAFT_ORDER_TABLE}" where left("negotiation_id", ${prefix}) = ?`, [DEMO_ID_PREFIX])
        await tx.raw(`delete from "${THREAD_TABLE}" where left("id", ${prefix}) = ?`, [DEMO_ID_PREFIX])
        for (const t of threads) {
          const v = threadValues(t)
          await tx.raw(`${INSERT_THREAD}${v.sql} on conflict ("id") do nothing`, v.bindings)
        }
        for (const m of messages) {
          const v = messageValues(m)
          await tx.raw(`${INSERT_MESSAGE}${v.sql} on conflict ("id") do nothing`, v.bindings)
        }
      })
    },

    async countDemoStory() {
      const [row] = rowsOf<{ count: number | string }>(
        await sql.raw(`select count(*)::int as "count" from "${THREAD_TABLE}" where left("id", ${DEMO_ID_PREFIX.length}) = ? and "deleted_at" is null`, [DEMO_ID_PREFIX]),
      )
      return Number(row?.count ?? 0)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Settings and runs                                                   */
/* ------------------------------------------------------------------ */

export interface RunInsert {
  id: string
  kind: string
  trigger: string
  status: string
  demo: boolean
  counts: Record<string, unknown> | null
  message: string | null
  started_at: Date
  finished_at: Date
  duration_ms: number
}

export interface SettingStore {
  get(keys: readonly string[]): Promise<SettingRow[]>
  put(key: string, value: unknown, updatedBy: string | null, now: Date): Promise<SettingRow | null>
  recordRun(run: RunInsert, keep: number): Promise<RunRow | null>
  runs(demo: boolean, limit: number): Promise<RunRow[]>
  lastRuns(demo: boolean): Promise<RunRow[]>
}

export function createSettingStore(sql: SqlRunner, newId: (prefix: string) => string): SettingStore {
  return {
    async get(keys) {
      if (keys.length === 0) return []
      return rowsOf<SettingRow>(await sql.raw(`select * from "${SETTING_TABLE}" where "key" in (${list(keys.length)}) and "deleted_at" is null`, [...keys]))
    },

    async put(key, value, updatedBy, now) {
      const [row] = rowsOf<SettingRow>(
        await sql.raw(
          `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at") values (?, ?, ?::jsonb, ?, ?, ?)
           on conflict ("key") do update set "value" = excluded."value", "updated_by" = excluded."updated_by", "updated_at" = excluded."updated_at", "deleted_at" = null
           returning *`,
          [newId("negset"), key, JSON.stringify(value ?? null), updatedBy, now, now],
        ),
      )
      return row ?? null
    },

    async recordRun(run, keep) {
      const [row] = rowsOf<RunRow>(
        await sql.raw(
          `insert into "${RUN_TABLE}" ("id", "kind", "trigger", "status", "demo", "counts", "message", "started_at", "finished_at", "duration_ms", "created_at", "updated_at")
           values (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?) returning *`,
          [run.id, run.kind, run.trigger, run.status, run.demo, run.counts === null ? null : JSON.stringify(run.counts), run.message, run.started_at, run.finished_at, run.duration_ms, run.finished_at, run.finished_at],
        ),
      )
      await sql.raw(
        `delete from "${RUN_TABLE}" where "id" in (select "id" from "${RUN_TABLE}" where "kind" = ? and "demo" = ? order by "started_at" desc offset ?)`,
        [run.kind, run.demo, keep],
      )
      return row ?? null
    },

    async runs(demo, limit) {
      return rowsOf<RunRow>(await sql.raw(`select * from "${RUN_TABLE}" where "demo" = ? and "deleted_at" is null order by "started_at" desc limit ?`, [demo, limit]))
    },

    async lastRuns(demo) {
      return rowsOf<RunRow>(
        await sql.raw(`select distinct on ("kind") * from "${RUN_TABLE}" where "demo" = ? and "deleted_at" is null order by "kind", "started_at" desc`, [demo]),
      )
    },
  }
}

/* ------------------------------------------------------------------ */
/* The draft order outbox                                              */
/* ------------------------------------------------------------------ */

export const DRAFT_PATCHABLE = ["state", "draft_order_id", "display_id", "error", "payload", "attempts", "requested_by"] as const
export type DraftPatch = Partial<Record<(typeof DRAFT_PATCHABLE)[number], unknown>>
const DRAFT_JSON: ReadonlySet<string> = new Set(["payload"])

/** States a create may be (re)tried from. */
export const DRAFT_CLAIMABLE = ["pending", "failed"] as const

export interface DraftOrderStore {
  /** One row per thread and mode: a second queue of the same thread is ignored (null). */
  queue(row: { id: string; negotiation_id: string; demo: boolean; requested_by: string | null; now: Date }): Promise<DraftOrderRow | null>
  list(demo: boolean, states: readonly string[] | null, limit: number): Promise<DraftOrderRow[]>
  byThreads(threadIds: readonly string[], demo: boolean): Promise<DraftOrderRow[]>
  /** pending or failed becomes creating, for exactly one caller. */
  claim(id: string, args: { now: Date; leaseUntil: Date; token: string }): Promise<DraftOrderRow | null>
  /** The result of a create, only for the owner of the claim. */
  finish(id: string, token: string, patch: DraftPatch, now: Date): Promise<boolean>
  transition(id: string, from: readonly string[], patch: DraftPatch, now: Date): Promise<DraftOrderRow | null>
  /** creating rows whose lease ran out become unknown: the process died mid-create. */
  expireLeases(now: Date, demo: boolean): Promise<DraftOrderRow[]>
  counts(demo: boolean): Promise<Record<string, number>>
}

export function createDraftOrderStore(sql: SqlRunner): DraftOrderStore {
  return {
    async queue(r) {
      const [row] = rowsOf<DraftOrderRow>(
        await sql.raw(
          `insert into "${DRAFT_ORDER_TABLE}" ("id", "negotiation_id", "demo", "state", "attempts", "requested_by", "created_at", "updated_at")
           values (?, ?, ?, 'pending', 0, ?, ?, ?) on conflict do nothing returning *`,
          [r.id, r.negotiation_id, r.demo, r.requested_by, r.now, r.now],
        ),
      )
      return row ?? null
    },

    async list(demo, states, limit) {
      const filter = states && states.length > 0 ? ` and "state" in (${list(states.length)})` : ""
      return rowsOf<DraftOrderRow>(
        await sql.raw(`select * from "${DRAFT_ORDER_TABLE}" where "deleted_at" is null and "demo" = ?${filter} order by "created_at" asc limit ?`, [demo, ...(states ?? []), limit]),
      )
    },

    async byThreads(threadIds, demo) {
      if (threadIds.length === 0) return []
      return rowsOf<DraftOrderRow>(
        await sql.raw(`select * from "${DRAFT_ORDER_TABLE}" where "deleted_at" is null and "demo" = ? and "negotiation_id" in (${list(threadIds.length)})`, [demo, ...threadIds]),
      )
    },

    async claim(id, args) {
      const [row] = rowsOf<DraftOrderRow>(
        await sql.raw(
          `update "${DRAFT_ORDER_TABLE}" set "state" = 'creating', "claim_token" = ?, "claimed_at" = ?, "lease_until" = ?, "attempts" = "attempts" + 1, "updated_at" = ?
           where "id" = ? and "deleted_at" is null and "state" in ('pending', 'failed') returning *`,
          [args.token, args.now, args.leaseUntil, args.now, id],
        ),
      )
      return row ?? null
    },

    async finish(id, token, patch, now) {
      const set = setClause(patch as Record<string, unknown>, DRAFT_PATCHABLE, DRAFT_JSON)
      const assignments = [set.sql, `"claim_token" = null`, `"lease_until" = null`, `"updated_at" = ?`].filter(Boolean).join(", ")
      const rows = rowsOf<{ id: string }>(
        await sql.raw(`update "${DRAFT_ORDER_TABLE}" set ${assignments} where "id" = ? and "state" = 'creating' and "claim_token" = ? returning "id"`, [
          ...set.bindings,
          now,
          id,
          token,
        ]),
      )
      return rows.length > 0
    },

    async transition(id, from, patch, now) {
      if (from.length === 0) return null
      const set = setClause(patch as Record<string, unknown>, DRAFT_PATCHABLE, DRAFT_JSON)
      const assignments = [set.sql, `"updated_at" = ?`].filter(Boolean).join(", ")
      const [row] = rowsOf<DraftOrderRow>(
        await sql.raw(`update "${DRAFT_ORDER_TABLE}" set ${assignments} where "id" = ? and "deleted_at" is null and "state" in (${list(from.length)}) returning *`, [
          ...set.bindings,
          now,
          id,
          ...from,
        ]),
      )
      return row ?? null
    },

    async expireLeases(now, demo) {
      return rowsOf<DraftOrderRow>(
        await sql.raw(
          `update "${DRAFT_ORDER_TABLE}" set "state" = 'unknown', "claim_token" = null, "lease_until" = null, "updated_at" = ?
           where "state" = 'creating' and "lease_until" < ? and "demo" = ? and "deleted_at" is null returning *`,
          [now, now, demo],
        ),
      )
    },

    async counts(demo) {
      const rows = rowsOf<{ state: string; count: number | string }>(
        await sql.raw(`select "state", count(*)::int as "count" from "${DRAFT_ORDER_TABLE}" where "deleted_at" is null and "demo" = ? group by "state"`, [demo]),
      )
      const out: Record<string, number> = {}
      for (const r of rows) out[r.state] = Number(r.count) || 0
      return out
    },
  }
}
