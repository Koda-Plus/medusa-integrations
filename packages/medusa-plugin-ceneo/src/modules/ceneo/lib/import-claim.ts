/**
 * THE ATOMIC STEPS OF THE IMPORT, in SQL. Zero imports: the connection is
 * injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the tests check the statements without a database.
 *
 * WHY RAW SQL: the generated service updates "by selector" by listing the
 * rows first and updating them by id afterwards, so two processes could
 * both claim one order and create two Medusa orders. A claim is ONE
 * statement; Postgres lets exactly one of two concurrent ones see the old
 * state. Writing the result goes through the claim token, so a process
 * whose lease ran out cannot overwrite the one that took over.
 */

import { ORDER_TABLE, WRITER_TABLE } from "./constants"

export interface SqlRunner {
  raw(sql: string, bindings?: readonly unknown[]): Promise<unknown>
}

export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

const T = `"${ORDER_TABLE}"`

/**
 * Claims one order for import: a new one (no Medusa order, no status) or a
 * failed one whose pause is over. True when this process holds it now.
 */
export async function claimImport(sql: SqlRunner, id: string, args: { token: string; leaseUntil: Date; now: Date; maxAttempts: number }): Promise<boolean> {
  const result = await sql.raw(
    `update ${T}
     set "import_status" = 'importing', "import_claim" = ?, "import_lease_until" = ?, "import_attempts" = "import_attempts" + 1, "updated_at" = now()
     where "id" = ? and "deleted_at" is null
       and (("import_status" is null and "medusa_order_id" is null)
         or ("import_status" = 'failed' and "import_attempts" < ? and ("import_next_at" is null or "import_next_at" <= ?)))
     returning "id"`,
    [args.token, args.leaseUntil, id, args.maxAttempts, args.now],
  )
  return rowsOf(result).length > 0
}

/**
 * The Medusa draft exists: its id is written at once, and NOT under the
 * claim. A lost claim must never leave a Medusa order the row does not
 * know: whoever holds the row next sees it and finishes it instead of
 * creating a second one. False only when the row already names another
 * order (then the caller stops and a person decides).
 */
export async function recordDraft(sql: SqlRunner, id: string, medusaOrderId: string): Promise<boolean> {
  const result = await sql.raw(
    `update ${T} set "medusa_order_id" = ?, "updated_at" = now()
     where "id" = ? and "medusa_order_id" is null and "deleted_at" is null
     returning "id"`,
    [medusaOrderId, id],
  )
  return rowsOf(result).length > 0
}

export type ImportEnd =
  | { status: "imported"; importedAt: Date }
  | { status: "failed"; error: string; nextAt: Date | null }
  | { status: "held"; error: string }

/** Ends the claim with its result. False when the claim was lost meanwhile. */
export async function finishImport(sql: SqlRunner, id: string, token: string, end: ImportEnd): Promise<boolean> {
  const set =
    end.status === "imported"
      ? { sql: `"import_status" = 'imported', "import_error" = null, "import_next_at" = null, "imported_at" = ?, "writes_due" = true`, bindings: [end.importedAt] as unknown[] }
      : end.status === "failed"
        ? { sql: `"import_status" = 'failed', "import_error" = ?, "import_next_at" = ?`, bindings: [end.error.slice(0, 1000), end.nextAt] as unknown[] }
        : { sql: `"import_status" = 'held', "import_error" = ?, "import_next_at" = null`, bindings: [end.error.slice(0, 1000)] as unknown[] }
  const result = await sql.raw(
    `update ${T} set ${set.sql}, "import_claim" = null, "import_lease_until" = null, "updated_at" = now()
     where "id" = ? and "import_status" = 'importing' and "import_claim" = ? and "deleted_at" is null
     returning "id"`,
    [...set.bindings, id, token],
  )
  return rowsOf(result).length > 0
}

/**
 * Claims whose process died. With a Medusa order they become `failed` (the
 * next attempt finishes the draft); without one they are HELD: the process
 * may have created an order whose id it never wrote, and a second order
 * would be worse than a person looking once.
 */
export async function releaseStale(sql: SqlRunner, now: Date): Promise<number> {
  const result = await sql.raw(
    `update ${T}
     set "import_status" = case when "medusa_order_id" is null then 'held' else 'failed' end,
         "import_error" = case when "medusa_order_id" is null
           then 'The import stopped halfway. Check the Medusa orders for this Ceneo order, then retry or leave it.'
           else 'The import stopped halfway; the next run finishes the Medusa order.' end,
         "import_next_at" = null, "import_claim" = null, "import_lease_until" = null, "updated_at" = now()
     where "import_status" = 'importing' and "import_lease_until" < ? and "deleted_at" is null
     returning "id"`,
    [now],
  )
  return rowsOf(result).length
}

/** A person retries a held or failed order: back to the queue with fresh attempts. */
export async function retryImport(sql: SqlRunner, id: string): Promise<boolean> {
  const result = await sql.raw(
    `update ${T}
     set "import_status" = case when "medusa_order_id" is null then null else 'failed' end,
         "import_attempts" = 0, "import_next_at" = null, "import_error" = null, "updated_at" = now()
     where "id" = ? and "import_status" in ('held', 'failed') and "deleted_at" is null
     returning "id"`,
    [id],
  )
  return rowsOf(result).length > 0
}

/**
 * Merges keys into `ceneo_writes` IN SQL (`||` on jsonb): a run that read
 * the row minutes ago never overwrites what a subscriber added meanwhile (a
 * shipment, a cancellation). Only the keys given change. `due` sets the
 * flag the status writer selects on; `cancelHandled` marks a Ceneo
 * cancellation as dealt with.
 */
export async function mergeWrites(sql: SqlRunner, id: string, patch: Record<string, unknown>, flags: { due?: boolean; cancelHandled?: Date; readAt?: Date | null } = {}): Promise<void> {
  const sets = [`"ceneo_writes" = coalesce("ceneo_writes", '{}'::jsonb) || ?::jsonb`]
  const bindings: unknown[] = [JSON.stringify(patch)]
  if (flags.due === true) sets.push(`"writes_due" = true`)
  else if (flags.due === false && flags.readAt) {
    /* Off the queue only when nobody touched the row since it was read: an event meanwhile (a cancellation) keeps it due. */
    sets.push(`"writes_due" = case when date_trunc('milliseconds', "updated_at") <= ? then false else "writes_due" end`)
    bindings.push(flags.readAt)
  } else if (flags.due === false) sets.push(`"writes_due" = false`)
  if (flags.cancelHandled) {
    sets.push(`"cancel_handled_at" = ?`)
    bindings.push(flags.cancelHandled)
  }
  await sql.raw(`update ${T} set ${sets.join(", ")}, "updated_at" = now() where "id" = ? and "deleted_at" is null`, [...bindings, id])
}

const W = `"${WRITER_TABLE}"`

/**
 * A run lease in the database, on the writer's row: one run per writer
 * across every process (a worker and a server, two servers). The
 * in-process lock stays in front of it; this is what holds between them.
 */
export async function takeRunLease(sql: SqlRunner, writer: string, token: string, until: Date, now: Date): Promise<boolean> {
  const result = await sql.raw(
    `update ${W} set "lease_token" = ?, "lease_until" = ?, "updated_at" = now()
     where "id" = ? and "deleted_at" is null and ("lease_until" is null or "lease_until" < ?)
     returning "id"`,
    [token, until, writer, now],
  )
  return rowsOf(result).length > 0
}

export async function releaseRunLease(sql: SqlRunner, writer: string, token: string): Promise<void> {
  await sql.raw(`update ${W} set "lease_token" = null, "lease_until" = null, "updated_at" = now() where "id" = ? and "lease_token" = ?`, [writer, token])
}

/** Runs `fn` under the writer's database lease; null when another process holds it. */
export async function withRunLease<T>(sql: SqlRunner, writer: string, ms: number, fn: () => Promise<T>): Promise<T | null> {
  const token = `${writer}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
  if (!(await takeRunLease(sql, writer, token, new Date(Date.now() + ms), new Date()))) return null
  try {
    return await fn()
  } finally {
    await releaseRunLease(sql, writer, token).catch(() => undefined)
  }
}

/**
 * A person resumes the writes of an imported order that waits for them
 * (`attention`, or out of attempts): the note and the error go, the
 * attempts start again, the status writer takes it on its next run. The
 * steps already sent stay sent.
 */
export async function resumeWrites(sql: SqlRunner, id: string, maxAttempts: number): Promise<boolean> {
  const result = await sql.raw(
    `update ${T}
     set "ceneo_writes" = (coalesce("ceneo_writes", '{}'::jsonb) - 'attention' - 'error' - 'error_at') || '{"attempts":0}'::jsonb,
         "writes_due" = true, "updated_at" = now()
     where "id" = ? and "import_status" = 'imported' and "deleted_at" is null
       and ("ceneo_writes"->>'attention' is not null or coalesce(("ceneo_writes"->>'attempts')::int, 0) >= ?)
     returning "id"`,
    [id, maxAttempts],
  )
  return rowsOf(result).length > 0
}
