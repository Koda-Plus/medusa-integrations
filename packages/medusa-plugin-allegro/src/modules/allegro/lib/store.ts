/**
 * THE ATOMIC OPERATIONS, in SQL. Zero imports: the database connection is
 * injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory store.
 *
 * WHY RAW SQL: the generated service updates "by selector" by listing the
 * rows first and updating them by id afterwards. Two processes can both list
 * a pending row and both "claim" it. A claim must be ONE statement:
 *
 *   update ... set status = 'importing' ... where id = ? and status in (...) returning *
 *
 * Postgres lets exactly one of two concurrent statements see the old status;
 * the other updates nothing and walks away. The same holds for the inserts
 * (`on conflict do nothing` against the unique indexes), for writing the
 * result (only the claim's owner, by its token) and for the run leases.
 *
 * Reads and plain updates go through the generated module service.
 */

export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

export const IMPORT_TABLE = "allegro_order_import"
export const OUTBOX_TABLE = "allegro_outbox"
export const STATE_TABLE = "allegro_state"
export const CONNECTION_TABLE = "allegro_connection"

/* ------------------------------------------------------------------ */
/* Patches: only known columns ever reach the SQL text                  */
/* ------------------------------------------------------------------ */

const IMPORT_COLUMNS = [
  "status",
  "reason_code",
  "reason",
  "order_id",
  "display_id",
  "allegro_status",
  "fulfillment_status",
  "payment_type",
  "paid",
  "total",
  "medusa_total",
  "total_mismatch",
  "line_count",
  "bought_at",
  "last_event_id",
  "last_event_type",
  "attempts",
  "next_attempt_at",
  "attention",
  "cancel_requested",
  "refresh_requested",
  "cancelled_on_allegro_at",
  "imported_at",
  "details",
] as const

const OUTBOX_COLUMNS = ["status", "attempts", "next_attempt_at", "last_error", "result", "done_at", "payload"] as const

const JSON_COLUMNS: ReadonlySet<string> = new Set(["total", "medusa_total", "details", "result", "payload", "value"])

export type ImportPatch = Partial<Record<(typeof IMPORT_COLUMNS)[number], unknown>>
export type OutboxPatch = Partial<Record<(typeof OUTBOX_COLUMNS)[number], unknown>>

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

/* ------------------------------------------------------------------ */
/* Order imports                                                       */
/* ------------------------------------------------------------------ */

export interface ImportRowLike {
  id: string
  checkout_form_id: string
  status: string
  attempts: number
  claim_token?: string | null
  [key: string]: unknown
}

export interface NewImport {
  checkout_form_id: string
  status: string
  source: string
  demo: boolean
  reason_code?: string | null
  reason?: string | null
  last_event_id?: string | null
  last_event_type?: string | null
  next_attempt_at?: Date | null
  bought_at?: Date | null
  cancel_requested?: boolean
}

export interface ImportStore {
  /** Inserts the row; null when the unique index already holds one for this checkout form. */
  insertIgnore(row: NewImport): Promise<ImportRowLike | null>
  /** pending or unknown, and due, becomes importing for exactly one caller. */
  claim(id: string, args: { now: Date; leaseUntil: Date; token: string }): Promise<ImportRowLike | null>
  /** Writes the result, only for the owner of the claim. */
  finish(id: string, token: string, patch: ImportPatch): Promise<boolean>
  /** Writes on the row while the claim stays held (the order id the moment the order exists). */
  progress(id: string, token: string, patch: ImportPatch): Promise<boolean>
  /** Moves a row only from one of the given states. */
  transition(id: string, from: readonly string[], patch: ImportPatch): Promise<ImportRowLike | null>
  /** Importing rows whose lease ran out become unknown: looked up before anything is created again. */
  expireLeases(now: Date): Promise<number>
}

export function createImportStore(deps: { sql: SqlRunner; newId: () => string }): ImportStore {
  const { sql, newId } = deps
  return {
    async insertIgnore(row) {
      const result = await sql.raw(
        `insert into "${IMPORT_TABLE}" ("id", "checkout_form_id", "status", "source", "demo", "reason_code", "reason", "last_event_id", "last_event_type", "next_attempt_at", "bought_at", "cancel_requested", "attempts", "paid", "total_mismatch", "line_count", "refresh_requested", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, false, false, 0, false, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId(),
          row.checkout_form_id,
          row.status,
          row.source,
          row.demo,
          row.reason_code ?? null,
          row.reason ?? null,
          row.last_event_id ?? null,
          row.last_event_type ?? null,
          row.next_attempt_at ?? null,
          row.bought_at ?? null,
          row.cancel_requested ?? false,
        ],
      )
      return rowsOf<ImportRowLike>(result)[0] ?? null
    },

    async claim(id, args) {
      const result = await sql.raw(
        `update "${IMPORT_TABLE}"
         set "status" = 'importing', "claim_token" = ?, "lease_until" = ?, "attempts" = "attempts" + 1, "updated_at" = now()
         where "id" = ? and "status" in ('pending', 'unknown') and "deleted_at" is null
           and ("next_attempt_at" is null or "next_attempt_at" <= ?)
         returning *`,
        [args.token, args.leaseUntil, id, args.now],
      )
      return rowsOf<ImportRowLike>(result)[0] ?? null
    },

    async progress(id, token, patch) {
      const set = setClause(patch as Record<string, unknown>, IMPORT_COLUMNS)
      const result = await sql.raw(
        `update "${IMPORT_TABLE}" set ${set.sql}
         where "id" = ? and "status" = 'importing' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },

    async finish(id, token, patch) {
      const set = setClause(patch as Record<string, unknown>, IMPORT_COLUMNS)
      const result = await sql.raw(
        `update "${IMPORT_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "status" = 'importing' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },

    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = setClause(patch as Record<string, unknown>, IMPORT_COLUMNS)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${IMPORT_TABLE}" set ${set.sql}
         where "id" = ? and "status" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<ImportRowLike>(result)[0] ?? null
    },

    async expireLeases(now) {
      const result = await sql.raw(
        `update "${IMPORT_TABLE}"
         set "status" = 'unknown', "claim_token" = null, "lease_until" = null, "reason_code" = 'lease_expired',
             "reason" = ?, "next_attempt_at" = ?, "updated_at" = now()
         where "status" = 'importing' and "lease_until" < ? and "deleted_at" is null
         returning "id"`,
        ["The process stopped while this order was being imported. Medusa is checked for the order before anything is created again.", now, now],
      )
      return rowsOf(result).length
    },
  }
}

/* ------------------------------------------------------------------ */
/* Outbox (parcels, seller status, invoices)                           */
/* ------------------------------------------------------------------ */

export interface OutboxRowLike {
  id: string
  writer: string
  dedupe_key: string
  status: string
  attempts: number
  checkout_form_id: string
  order_id: string | null
  payload: Record<string, unknown> | null
  demo: boolean
  [key: string]: unknown
}

export interface NewOutbox {
  writer: string
  dedupeKey: string
  checkout_form_id: string
  order_id: string | null
  payload: Record<string, unknown>
  demo: boolean
  next_attempt_at?: Date | null
}

export interface OutboxStore {
  insertIgnore(row: NewOutbox): Promise<OutboxRowLike | null>
  claim(id: string, args: { now: Date; leaseUntil: Date; token: string }): Promise<OutboxRowLike | null>
  finish(id: string, token: string, patch: OutboxPatch): Promise<boolean>
  transition(id: string, from: readonly string[], patch: OutboxPatch): Promise<OutboxRowLike | null>
  expireLeases(now: Date): Promise<number>
}

export function createOutboxStore(deps: { sql: SqlRunner; newId: () => string }): OutboxStore {
  const { sql, newId } = deps
  return {
    async insertIgnore(row) {
      const result = await sql.raw(
        `insert into "${OUTBOX_TABLE}" ("id", "writer", "dedupe_key", "checkout_form_id", "order_id", "payload", "status", "attempts", "next_attempt_at", "demo", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?::jsonb, 'pending', 0, ?, ?, now(), now())
         on conflict do nothing
         returning *`,
        [newId(), row.writer, row.dedupeKey, row.checkout_form_id, row.order_id, JSON.stringify(row.payload), row.next_attempt_at ?? null, row.demo],
      )
      return rowsOf<OutboxRowLike>(result)[0] ?? null
    },

    async claim(id, args) {
      const result = await sql.raw(
        `update "${OUTBOX_TABLE}"
         set "status" = 'sending', "claim_token" = ?, "lease_until" = ?, "attempts" = "attempts" + 1, "updated_at" = now()
         where "id" = ? and "status" in ('pending', 'unknown') and "deleted_at" is null
           and ("next_attempt_at" is null or "next_attempt_at" <= ?)
         returning *`,
        [args.token, args.leaseUntil, id, args.now],
      )
      return rowsOf<OutboxRowLike>(result)[0] ?? null
    },

    async finish(id, token, patch) {
      const set = setClause(patch as Record<string, unknown>, OUTBOX_COLUMNS)
      const result = await sql.raw(
        `update "${OUTBOX_TABLE}" set ${set.sql}, "claim_token" = null, "lease_until" = null
         where "id" = ? and "status" = 'sending' and "claim_token" = ? and "deleted_at" is null
         returning "id"`,
        [...set.bindings, id, token],
      )
      return rowsOf(result).length > 0
    },

    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = setClause(patch as Record<string, unknown>, OUTBOX_COLUMNS)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${OUTBOX_TABLE}" set ${set.sql}
         where "id" = ? and "status" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<OutboxRowLike>(result)[0] ?? null
    },

    async expireLeases(now) {
      const result = await sql.raw(
        `update "${OUTBOX_TABLE}"
         set "status" = 'unknown', "claim_token" = null, "lease_until" = null,
             "last_error" = ?, "next_attempt_at" = ?, "updated_at" = now()
         where "status" = 'sending' and "lease_until" < ? and "deleted_at" is null
         returning "id"`,
        ["The process stopped while this was being sent. Allegro is checked before anything is sent again.", now, now],
      )
      return rowsOf(result).length
    },
  }
}

/* ------------------------------------------------------------------ */
/* Run leases (one stock or price run across processes)                */
/* ------------------------------------------------------------------ */

export async function takeLease(sql: SqlRunner, key: string, owner: string, ms: number): Promise<boolean> {
  const until = new Date(Date.now() + ms).toISOString()
  const result = await sql.raw(
    `insert into "${STATE_TABLE}" ("id", "value", "created_at", "updated_at")
     values (?, ?::jsonb, now(), now())
     on conflict ("id") do update set "value" = excluded."value", "updated_at" = now(), "deleted_at" = null
     where "${STATE_TABLE}"."deleted_at" is not null
        or ("${STATE_TABLE}"."value"->>'until') is null
        or ("${STATE_TABLE}"."value"->>'until')::timestamptz < now()
     returning "id"`,
    [`lease:${key}`, JSON.stringify({ owner, until })],
  )
  return rowsOf(result).length > 0
}

export async function releaseLease(sql: SqlRunner, key: string, owner: string): Promise<void> {
  await sql.raw(
    `update "${STATE_TABLE}" set "value" = jsonb_build_object('owner', null, 'until', null), "updated_at" = now()
     where "id" = ? and "value"->>'owner' = ?`,
    [`lease:${key}`, owner],
  )
}

/* ------------------------------------------------------------------ */
/* Token refresh lease (one refresh across processes)                  */
/* ------------------------------------------------------------------ */

/**
 * Takes the refresh lease of the connection row. Allegro rotates the refresh
 * token on every use and keeps the old one for 60 seconds only, so two
 * processes refreshing at the same moment can invalidate each other. The
 * lease makes one of them refresh and the other read the result.
 */
export async function takeRefreshLease(sql: SqlRunner, id: string, owner: string, ms: number): Promise<boolean> {
  const result = await sql.raw(
    `update "${CONNECTION_TABLE}"
     set "refresh_lease_until" = ?, "refresh_lease_owner" = ?
     where "id" = ? and "deleted_at" is null and ("refresh_lease_until" is null or "refresh_lease_until" < now())
     returning "id"`,
    [new Date(Date.now() + ms), owner, id],
  )
  return rowsOf(result).length > 0
}

export async function releaseRefreshLease(sql: SqlRunner, id: string, owner: string): Promise<void> {
  await sql.raw(
    `update "${CONNECTION_TABLE}" set "refresh_lease_until" = null, "refresh_lease_owner" = null
     where "id" = ? and "refresh_lease_owner" = ?`,
    [id, owner],
  )
}

/* ------------------------------------------------------------------ */
/* Lookups in Medusa tables                                            */
/* ------------------------------------------------------------------ */

/**
 * Medusa orders carrying `metadata.marketplace_order_ref`. Any of them counts,
 * whoever created it: the BaseLinker integration writes the same key for
 * Allegro orders it imports, and the second importer must step back.
 *
 * `ours` (this plugin may finish and pay the order) never rests on metadata
 * alone, which a shopper could have put on a cart: the order is ours when an
 * import row names it in `order_id`, or when it is still a draft with our
 * checkout form key that no cart ever placed (a draft an attempt created
 * just before it stopped, before it could write the id on its row).
 */
export async function ordersByRef(
  sql: SqlRunner,
  refs: readonly string[],
): Promise<Array<{ id: string; ref: string; display_id: number | null; ours: boolean; draft: boolean }>> {
  if (refs.length === 0) return []
  const placeholders = refs.map(() => "?").join(", ")
  const result = await sql.raw(
    `select o."id", o."display_id", o."metadata"->>'marketplace_order_ref' as "ref",
            (exists (select 1 from "allegro_order_import" i
                     where i."order_id" = o."id" and i."deleted_at" is null and i."reason_code" is distinct from 'duplicate_ref')
             or ((o."status" = 'draft' or coalesce(o."is_draft_order", false))
                 and (o."metadata"->>'allegro_checkout_form_id') is not null
                 and not exists (select 1 from "order_cart" oc where oc."order_id" = o."id" and oc."deleted_at" is null))) as "ours",
            (o."status" = 'draft' or coalesce(o."is_draft_order", false)) as "draft"
     from "order" o
     where o."deleted_at" is null and o."metadata"->>'marketplace_order_ref' in (${placeholders})
     order by o."created_at" asc`,
    [...refs],
  )
  return rowsOf<{ id: string; ref: string; display_id: number | string | null; ours: boolean; draft: boolean }>(result).map((r) => ({
    id: String(r.id),
    ref: String(r.ref),
    display_id: r.display_id === null || r.display_id === undefined ? null : Number(r.display_id),
    ours: Boolean(r.ours),
    draft: Boolean(r.draft),
  }))
}
