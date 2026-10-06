/**
 * THE SEND LOG AND THE SETTINGS, in SQL. Types and SQL text only: the
 * connection is injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory twin.
 *
 * WHY RAW SQL. The notification provider runs inside Medusa's notification
 * module, where the module service of this plugin cannot be resolved; the
 * shared database connection can. And a claim must be ONE statement:
 *
 *   insert into emails_message (... 'sending' ...) on conflict do nothing returning *
 *
 * Against the unique index on (key, demo), exactly one of two processes that
 * got the same event inserts the row and sends; the other gets nothing back
 * and stands down. Writing the result is allowed only for the claim's owner
 * (its token), and a person's retry takes a row over only from the states it
 * may come from.
 *
 * Reads for the admin (lists, counts) go through the generated module service
 * or the read statements below.
 */

import { MESSAGE_TABLE, SETTING_TABLE } from "./constants"
import type { SettingRow } from "./settings"

export type MessageStatus = "sending" | "sent" | "failed" | "unknown" | "skipped"
export type MessageKind = "event" | "job" | "test" | "app" | "seed"

export interface MessageRow {
  id: string
  key: string
  template: string
  locale: string | null
  demo: boolean
  kind: MessageKind | string
  status: MessageStatus | string
  recipient: string | null
  subject: string | null
  trigger: string | null
  resource_type: string | null
  resource_id: string | null
  order_id: string | null
  notification_id: string | null
  external_id: string | null
  resend_key: string | null
  rotation: number
  attempts: number
  error_code: string | null
  error: string | null
  retryable: boolean
  claim_token: string | null
  lease_until: Date | string | null
  sent_at: Date | string | null
  requested_by: string | null
  body_html: string | null
  body_text: string | null
  created_at: Date | string
  updated_at: Date | string
}

export interface NewMessage {
  key: string
  template: string
  locale: string | null
  demo: boolean
  kind: MessageKind
  recipient: string | null
  subject: string | null
  trigger: string | null
  resource_type: string | null
  resource_id: string | null
  order_id: string | null
  notification_id: string | null
  requested_by: string | null
  /** Dates a row other than now (the rows of the demo outbox). */
  created_at?: Date | null
}

export type MessagePatch = Partial<
  Pick<
    MessageRow,
    "status" | "subject" | "locale" | "recipient" | "external_id" | "error_code" | "error" | "retryable" | "sent_at" | "body_html" | "body_text" | "notification_id"
  >
>

export interface StatRow {
  template: string
  status: string
  count: number
  last_at: Date | string | null
}

export interface Counts {
  sent24h: number
  sent30d: number
  attention30d: number
  tests30d: number
  skipped30d: number
}

/** A finished row of the demo outbox, with the date the seed gives it. */
export type SeedMessage = NewMessage & MessagePatch & { status: MessageStatus; created_at: Date }

export interface MessageStore {
  /** Inserts a `sending` row with a lease; null when the key already has a row in this mode. */
  claimNew(m: NewMessage, args: { token: string; leaseUntil: Date; resendKey: string }): Promise<MessageRow | null>
  /**
   * A person's retry: takes over a failed, unknown or skipped row (or one
   * still `sending` whose lease ran out), with the Resend key rotated.
   * Null when the row is in none of those states.
   */
  claimRetry(key: string, demo: boolean, args: { token: string; leaseUntil: Date; notificationId: string | null; requestedBy: string | null }): Promise<MessageRow | null>
  /** Writes the result of an attempt, only for the owner of the claim. */
  finish(id: string, token: string, patch: MessagePatch): Promise<boolean>
  /** Inserts a finished row (simulated, logged, skipped); null when the key already has one. */
  record(m: NewMessage & MessagePatch & { status: MessageStatus }): Promise<MessageRow | null>
  /**
   * Swaps the seeded rows of the demo outbox for a new set, in one
   * transaction: each row is written, or refreshed under its key when a
   * seeded row holds it; a row of a real event or a test send under the same
   * key is left alone (and the seed row is dropped, never a duplicate); seeded
   * rows missing from the set are deleted. A seeded row in the middle of a
   * person's retry (`sending`) is left alone too.
   */
  replaceSeed(rows: readonly SeedMessage[]): Promise<{ written: number; removed: number }>
  find(key: string, demo: boolean): Promise<MessageRow | null>
  existingKeys(keys: readonly string[], demo: boolean): Promise<Set<string>>
  /** Rows still `sending` after their lease become `unknown` (the process stopped mid-send). */
  expireLeases(now: Date): Promise<number>
  /** Deletes rows of a mode created before a date (the retention of the log). */
  prune(before: Date, demo: boolean): Promise<number>
  stats(demo: boolean, since: Date): Promise<StatRow[]>
  counts(demo: boolean, now: Date): Promise<Counts>
  settings(): Promise<SettingRow[]>
  setSetting(key: string, value: unknown, by: string | null): Promise<void>
}

/** The smallest piece of Knex the store needs. */
export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
  /** Knex's transaction; without it (the unit tests) the statements run one after another. */
  transaction?<T>(handler: (trx: SqlRunner) => Promise<T>): Promise<T>
}

/** Columns a patch may set. Only these names ever reach the SQL text. */
export const PATCHABLE: readonly string[] = [
  "status",
  "subject",
  "locale",
  "recipient",
  "external_id",
  "error_code",
  "error",
  "retryable",
  "sent_at",
  "body_html",
  "body_text",
  "notification_id",
]

export function setClause(patch: MessagePatch): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  const values = patch as Record<string, unknown>
  for (const column of PATCHABLE) {
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

const NEW_COLUMNS = [
  "id",
  "key",
  "template",
  "locale",
  "demo",
  "kind",
  "status",
  "recipient",
  "subject",
  "trigger",
  "resource_type",
  "resource_id",
  "order_id",
  "notification_id",
  "requested_by",
  "resend_key",
  "rotation",
  "attempts",
  "claim_token",
  "lease_until",
  "retryable",
  "external_id",
  "error_code",
  "error",
  "sent_at",
  "body_html",
  "body_text",
  "created_at",
  "updated_at",
] as const

const INSERT_COLUMNS = NEW_COLUMNS.map((c) => `"${c}"`).join(", ")
const ROW_MARKS = `(${NEW_COLUMNS.map((c) => (c === "created_at" ? "coalesce(?, now())" : c === "updated_at" ? "now()" : "?")).join(", ")})`

function insertSql(): string {
  return `insert into "${MESSAGE_TABLE}" (${INSERT_COLUMNS}) values ${ROW_MARKS} on conflict do nothing returning *`
}

/** What a refreshed seed row takes over from the new one: everything but its id, key, mode and kind. */
const SEED_REFRESHED = NEW_COLUMNS.filter((c) => c !== "id" && c !== "key" && c !== "demo" && c !== "kind" && c !== "updated_at")

/**
 * One statement for the whole seed set: new keys are inserted, keys held by a
 * seeded row are refreshed, keys held by any other row stay as they are.
 */
function seedUpsertSql(rows: number): string {
  const set = [...SEED_REFRESHED.map((c) => `"${c}" = excluded."${c}"`), `"updated_at" = now()`].join(", ")
  return `insert into "${MESSAGE_TABLE}" (${INSERT_COLUMNS}) values ${Array.from({ length: rows }, () => ROW_MARKS).join(", ")}
     on conflict ("key", "demo") where "deleted_at" is null
     do update set ${set}
     where "${MESSAGE_TABLE}"."kind" = 'seed' and "${MESSAGE_TABLE}"."status" <> 'sending'
     returning "key"`
}

/** The columns of a finished row (simulated, logged, skipped, seeded). */
function finishedColumns(m: MessagePatch & { status: MessageStatus }): Record<string, unknown> {
  return {
    status: m.status,
    external_id: m.external_id ?? null,
    error_code: m.error_code ?? null,
    error: m.error ?? null,
    retryable: m.retryable ?? false,
    sent_at: m.sent_at ?? null,
    body_html: m.body_html ?? null,
    body_text: m.body_text ?? null,
    attempts: m.status === "skipped" ? 0 : 1,
  }
}

function insertBindings(id: string, m: NewMessage, extra: Record<string, unknown>): unknown[] {
  const v: Record<string, unknown> = {
    id,
    key: m.key,
    template: m.template,
    locale: m.locale,
    demo: m.demo,
    kind: m.kind,
    recipient: m.recipient,
    subject: m.subject,
    trigger: m.trigger,
    resource_type: m.resource_type,
    resource_id: m.resource_id,
    order_id: m.order_id,
    notification_id: m.notification_id,
    requested_by: m.requested_by,
    resend_key: null,
    rotation: 0,
    attempts: 0,
    claim_token: null,
    lease_until: null,
    retryable: false,
    external_id: null,
    error_code: null,
    error: null,
    sent_at: null,
    body_html: null,
    body_text: null,
    created_at: m.created_at ?? null,
    ...extra,
  }
  return NEW_COLUMNS.filter((c) => c !== "updated_at").map((c) => (v[c] === undefined ? null : v[c]))
}

export function createSqlStore(deps: { sql: SqlRunner; newId: (prefix: string) => string }): MessageStore {
  const { sql, newId } = deps
  return {
    async claimNew(m, args) {
      const result = await sql.raw(
        insertSql(),
        insertBindings(newId("emmsg"), m, { status: "sending", resend_key: args.resendKey, attempts: 1, claim_token: args.token, lease_until: args.leaseUntil }),
      )
      return rowsOf<MessageRow>(result)[0] ?? null
    },

    async claimRetry(key, demo, args) {
      const result = await sql.raw(
        `update "${MESSAGE_TABLE}"
         set "status" = 'sending', "rotation" = "rotation" + 1, "resend_key" = "key" || '#r' || ("rotation" + 1)::text,
             "attempts" = "attempts" + 1, "claim_token" = ?, "lease_until" = ?, "error" = null, "error_code" = null, "retryable" = false,
             "notification_id" = coalesce(?, "notification_id"), "requested_by" = coalesce(?, "requested_by"), "updated_at" = now()
         where "key" = ? and "demo" = ? and "deleted_at" is null
           and ("status" in ('failed', 'unknown', 'skipped') or ("status" = 'sending' and "lease_until" < now()))
         returning *`,
        [args.token, args.leaseUntil, args.notificationId, args.requestedBy, key, demo],
      )
      return rowsOf<MessageRow>(result)[0] ?? null
    },

    async finish(id, token, patch) {
      const set = setClause(patch)
      const result = await sql.raw(
        `update "${MESSAGE_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "claim_token" = ? and "status" = 'sending' and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },

    async record(m) {
      const result = await sql.raw(insertSql(), insertBindings(newId("emmsg"), m, finishedColumns(m)))
      return rowsOf<MessageRow>(result)[0] ?? null
    },

    async replaceSeed(input) {
      const keys = new Set<string>()
      const rows = input.filter((m) => m.demo && m.kind === "seed" && !keys.has(m.key) && Boolean(keys.add(m.key)))
      const run = async (q: SqlRunner) => {
        let written = 0
        if (rows.length > 0) {
          const result = await q.raw(
            seedUpsertSql(rows.length),
            rows.flatMap((m) => insertBindings(newId("emmsg"), m, finishedColumns(m))),
          )
          written = rowsOf(result).length
        }
        const keep = [...keys]
        const result = await q.raw(
          `delete from "${MESSAGE_TABLE}"
           where "demo" = true and "kind" = 'seed' and "status" <> 'sending' and "deleted_at" is null${keep.length > 0 ? ` and "key" not in (${keep.map(() => "?").join(", ")})` : ""}
           returning "id"`,
          keep,
        )
        return { written, removed: rowsOf(result).length }
      }
      return typeof sql.transaction === "function" ? sql.transaction((trx) => run(trx)) : run(sql)
    },

    async find(key, demo) {
      const result = await sql.raw(`select * from "${MESSAGE_TABLE}" where "key" = ? and "demo" = ? and "deleted_at" is null limit 1`, [key, demo])
      return rowsOf<MessageRow>(result)[0] ?? null
    },

    async existingKeys(keys, demo) {
      const list = [...new Set(keys)].slice(0, 1000)
      if (list.length === 0) return new Set()
      const marks = list.map(() => "?").join(", ")
      const result = await sql.raw(`select "key" from "${MESSAGE_TABLE}" where "demo" = ? and "deleted_at" is null and "key" in (${marks})`, [demo, ...list])
      return new Set(rowsOf<{ key: string }>(result).map((r) => r.key))
    },

    async expireLeases(now) {
      const result = await sql.raw(
        `update "${MESSAGE_TABLE}"
         set "status" = 'unknown', "error_code" = 'lease_expired', "error" = ?, "claim_token" = null, "lease_until" = null, "retryable" = true, "updated_at" = now()
         where "status" = 'sending' and "lease_until" < ? and "deleted_at" is null
         returning "id"`,
        ["The process stopped while the message was being sent. It may have gone out; it is not sent again automatically.", now],
      )
      return rowsOf(result).length
    },

    async prune(before, demo) {
      const result = await sql.raw(`delete from "${MESSAGE_TABLE}" where "demo" = ? and "created_at" < ? and "status" <> 'sending' returning "id"`, [demo, before])
      return rowsOf(result).length
    },

    async stats(demo, since) {
      const result = await sql.raw(
        `select "template", "status", count(*)::int as "count", max("created_at") as "last_at"
         from "${MESSAGE_TABLE}" where "demo" = ? and "created_at" >= ? and "deleted_at" is null
         group by "template", "status"`,
        [demo, since],
      )
      return rowsOf<StatRow>(result).map((r) => ({ ...r, count: Number(r.count) || 0 }))
    },

    async counts(demo, now) {
      const day = new Date(now.getTime() - 24 * 3600 * 1000)
      const month = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
      const result = await sql.raw(
        `select
           count(*) filter (where "status" = 'sent' and "created_at" >= ?)::int as "sent24h",
           count(*) filter (where "status" = 'sent')::int as "sent30d",
           count(*) filter (where "status" in ('failed', 'unknown'))::int as "attention30d",
           count(*) filter (where "kind" = 'test')::int as "tests30d",
           count(*) filter (where "status" = 'skipped')::int as "skipped30d"
         from "${MESSAGE_TABLE}" where "demo" = ? and "created_at" >= ? and "deleted_at" is null`,
        [day, demo, month],
      )
      const r = rowsOf<Record<string, unknown>>(result)[0] ?? {}
      const n = (v: unknown) => Number(v) || 0
      return { sent24h: n(r.sent24h), sent30d: n(r.sent30d), attention30d: n(r.attention30d), tests30d: n(r.tests30d), skipped30d: n(r.skipped30d) }
    },

    async settings() {
      const result = await sql.raw(`select "key", "value", "updated_by", "updated_at" from "${SETTING_TABLE}" where "deleted_at" is null`)
      return rowsOf<SettingRow>(result)
    },

    async setSetting(key, value, by) {
      await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at")
         values (?, ?, ?::jsonb, ?, now(), now())
         on conflict ("key") where "deleted_at" is null
         do update set "value" = excluded."value", "updated_by" = excluded."updated_by", "updated_at" = now()`,
        [newId("emset"), key, JSON.stringify(value ?? null), by],
      )
    },
  }
}

/** Whether a database error says the table is not there (the migrations did not run). */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  return e?.code === "42P01" || /relation .* does not exist|no such table/i.test(String(e?.message ?? ""))
}
