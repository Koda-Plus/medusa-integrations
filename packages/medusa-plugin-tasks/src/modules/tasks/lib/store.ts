/**
 * THE DATABASE OF THE MODULE, IN SQL. Types and SQL text only: the
 * connection is injected (`SqlRunner`, the Knex instance Medusa registers as
 * `__pg_connection__`), so the unit tests check the statements without a
 * database and drive the flows with an in-memory store of the same rules.
 *
 * ONE BOARD PER STORE. `createBoardStore(sql, board)` returns a store bound
 * to one board, and every statement it sends carries `"board" = ?` with that
 * board (tasks, comments, activity and links all have the column). The flows
 * get the store of the board the request context decided
 * (`lib/actor.ts`), so an id from another board is simply not found: a
 * sandbox account can never read or change a row of the main board, not
 * even by guessing ids. Only `createSandboxStore` writes across tasks of
 * one board at once, and only of the sandbox board.
 *
 * WHY SQL: a move renumbers a column in one transaction under a lock of the
 * board; a comment, a link or an update is written only when its task is on
 * the board, in the same statement; and the demo store this plugin comes
 * from broke module services that called their own generated methods (an
 * entity manager `fork` error), which plain SQL on Medusa's connection
 * cannot hit.
 *
 * Every column a statement writes is whitelisted; values travel as bindings.
 */

import {
  ACTIVITY_TABLE,
  CLOSED_STATUSES,
  COMMENT_TABLE,
  LINK_TABLE,
  OPEN_STATUSES,
  SANDBOX_BOARD,
  SETTING_TABLE,
  STATUSES,
  TASK_TABLE,
  URGENT_PRIORITIES,
} from "./constants"
import { planMove, positionChanges } from "./positions"
import type { ActivityInsert, ActivityRow, CommentInsert, CommentRow, LinkInsert, LinkRow, SettingRow, TaskInsert, TaskRow } from "./rows"

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
const quoteList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ")

const OPEN_SQL = quoteList(OPEN_STATUSES)
const CLOSED_SQL = quoteList(CLOSED_STATUSES)
const URGENT_SQL = quoteList(URGENT_PRIORITIES)
/* The board's column order, for lists: unknown values of old rows sort first, with backlog. */
const STATUS_ORDER = `(case "status" ${STATUSES.map((s, i) => `when '${s}' then ${i}`).join(" ")} else 0 end)`

/** The lock that serializes moves, appends and status changes on one board, for the transaction. */
export function boardLockKey(board: string): string {
  return `koda.tasks.board:${board}`
}

/* ------------------------------------------------------------------ */
/* Inserts                                                             */
/* ------------------------------------------------------------------ */

const TASK_INSERT_COLUMNS = [
  "id",
  "board",
  "title",
  "description",
  "status",
  "priority",
  "assignee",
  "assignee_id",
  "due_date",
  "tags",
  "completed_at",
  "created_by",
  "created_by_id",
  "metadata",
  "created_at",
  "updated_at",
] as const

const COMMENT_COLUMNS = ["id", "board", "task_id", "body", "author", "author_role", "author_id", "author_type", "metadata", "created_at", "updated_at"] as const
const ACTIVITY_COLUMNS = ["id", "board", "task_id", "type", "message", "actor", "actor_id", "actor_type", "metadata", "created_at", "updated_at"] as const
const LINK_COLUMNS = ["id", "board", "task_id", "entity_type", "entity_id", "created_by", "created_by_id", "created_at", "updated_at"] as const

const JSON_COLUMNS: ReadonlySet<string> = new Set(["tags", "metadata", "value"])

function binding(column: string, value: unknown): unknown {
  if (JSON_COLUMNS.has(column)) return value === null || value === undefined ? null : JSON.stringify(value)
  return value === undefined ? null : value
}

const placeholder = (column: string) => (JSON_COLUMNS.has(column) ? "?::jsonb" : "?")

/** `(?, ?, ?::jsonb...)` and the bindings of one row, in the order of `columns`. */
function valuesOf(columns: readonly string[], row: Record<string, unknown>): { sql: string; bindings: unknown[] } {
  return { sql: `(${columns.map(placeholder).join(", ")})`, bindings: columns.map((c) => binding(c, row[c])) }
}

function insertMany(table: string, columns: readonly string[], rows: ReadonlyArray<Record<string, unknown>>): { sql: string; bindings: unknown[] } | null {
  if (rows.length === 0) return null
  const parts = rows.map((r) => valuesOf(columns, r))
  return {
    sql: `insert into "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) values ${parts.map((p) => p.sql).join(", ")} returning *`,
    bindings: parts.flatMap((p) => p.bindings),
  }
}

/* ------------------------------------------------------------------ */
/* Updates                                                             */
/* ------------------------------------------------------------------ */

/** Task columns an update may set. Only these names ever reach the SQL text. */
export const TASK_PATCHABLE = [
  "title",
  "description",
  "status",
  "priority",
  "assignee",
  "assignee_id",
  "due_date",
  "tags",
  "completed_at",
  "metadata",
] as const

export type TaskPatch = Partial<Record<(typeof TASK_PATCHABLE)[number], unknown>>

export function setClause(patch: Record<string, unknown>, columns: readonly string[]): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  for (const column of columns) {
    if (!(column in patch) || patch[column] === undefined) continue
    parts.push(`"${column}" = ${placeholder(column)}`)
    bindings.push(binding(column, patch[column]))
  }
  return { sql: parts.join(", "), bindings }
}

/** What an update writes, computed from the locked row. */
export interface UpdatePlan {
  patch: TaskPatch
  activity: ActivityInsert[]
}

export interface MovePlan {
  /** Status, `completed_at` and the like; the position comes from the move. */
  patch: TaskPatch
  activity: ActivityInsert[]
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export interface TaskQuery {
  statuses?: readonly string[] | null
  priorities?: readonly string[] | null
  assigneeId?: string | null
  /** Free text assignee, compared without case. */
  assignee?: string | null
  /** Neither a user nor free text. */
  unassigned?: boolean
  tag?: string | null
  /** ILIKE pattern over title, description and assignee (`likePattern`). */
  like?: string | null
  link?: { type: string; id: string } | null
  limit: number
  offset: number
}

export interface StatusCountRow {
  status: string
  count: number
  overdue: number
  urgent: number
  unassigned: number
}

export interface BoardActivityRow extends ActivityRow {
  task_title: string | null
}

export interface BoardStore {
  readonly board: string
  /** Every open task (up to `openLimit`) and the latest closed ones, up to `closedLimit` per closed status. */
  boardTasks(openLimit: number, closedLimit: number): Promise<TaskRow[]>
  listTasks(q: TaskQuery): Promise<{ rows: TaskRow[]; count: number }>
  /** Per status, with overdue (due before `dayStart`), urgent and unassigned among open tasks. */
  statusCounts(dayStart: Date): Promise<StatusCountRow[]>
  getTask(id: string): Promise<TaskRow | null>
  commentCounts(taskIds: readonly string[]): Promise<Map<string, number>>
  /** A new task at the end of its column (or at `task.position`), with its links and activity. */
  insertTask(task: TaskInsert, links: readonly LinkInsert[], activity: readonly ActivityInsert[]): Promise<{ task: TaskRow; links: LinkRow[] }>
  /**
   * Locks the task, asks `plan` what to write, writes it. A status change
   * appends the task to its new column. Null when the task is not on this
   * board; `after` equals `before` when the plan changes nothing.
   */
  updateTask(id: string, plan: (before: TaskRow) => UpdatePlan | null, now: Date): Promise<{ before: TaskRow; after: TaskRow } | null>
  /** Places the task in `status` next to its new neighbours and renumbers the columns it left and joined. */
  moveTask(id: string, target: { status: string; beforeId: string | null; afterId: string | null }, plan: (before: TaskRow) => MovePlan, now: Date): Promise<{ before: TaskRow; after: TaskRow } | null>
  /** Soft deletes the task with its comments, links and activity, then logs `activity` (the deletion). */
  deleteTask(id: string, activity: readonly ActivityInsert[], now: Date): Promise<TaskRow | null>

  listComments(taskId: string): Promise<CommentRow[]>
  getComment(id: string): Promise<CommentRow | null>
  /** Only when the task is on this board and not deleted; null otherwise. */
  insertComment(comment: CommentInsert, activity: readonly ActivityInsert[]): Promise<CommentRow | null>
  updateComment(id: string, body: string, now: Date): Promise<CommentRow | null>
  deleteComment(id: string, now: Date): Promise<CommentRow | null>

  listActivity(taskId: string, limit: number): Promise<ActivityRow[]>
  /** The latest entries of the board, with the task's title (deleted tasks show only their deletion). */
  boardActivity(limit: number): Promise<BoardActivityRow[]>
  apiKeyActivity(): Promise<{ count: number; last: Date | string | null }>

  listLinks(taskIds: readonly string[]): Promise<LinkRow[]>
  /** `created: false` when the task already had this link; null when the task is not on this board. */
  insertLink(link: LinkInsert, activity: readonly ActivityInsert[]): Promise<{ link: LinkRow; created: boolean } | null>
  deleteLink(taskId: string, linkId: string, activity: readonly ActivityInsert[], now: Date): Promise<LinkRow | null>
  /** Tasks linked to one Medusa record: open first, then the latest. */
  tasksForEntity(type: string, entityId: string, limit: number): Promise<{ rows: TaskRow[]; count: number }>
}

/* ------------------------------------------------------------------ */
/* The board store                                                     */
/* ------------------------------------------------------------------ */

export function createBoardStore(sql: SqlRunner, board: string): BoardStore {
  const lockBoard = (tx: SqlRunner) => tx.raw(`select pg_advisory_xact_lock(hashtext(?))`, [boardLockKey(board)])

  const insertActivity = async (tx: SqlRunner, activity: readonly ActivityInsert[]) => {
    const q = insertMany(
      ACTIVITY_TABLE,
      ACTIVITY_COLUMNS,
      activity.map((a) => ({ ...a, board, updated_at: a.created_at })),
    )
    if (q) await tx.raw(q.sql, q.bindings)
  }

  const lockedTask = async (tx: SqlRunner, id: string): Promise<TaskRow | null> => {
    const [row] = rowsOf<TaskRow>(await tx.raw(`select * from "${TASK_TABLE}" where "id" = ? and "board" = ? and "deleted_at" is null for update`, [id, board]))
    return row ?? null
  }

  /** The other cards of a column, in order. */
  const column = async (tx: SqlRunner, status: string, exceptId: string): Promise<Array<{ id: string; position: number; created_at: Date | string }>> =>
    rowsOf<{ id: string; position: number; created_at: Date | string }>(
      await tx.raw(
        `select "id", "position", "created_at" from "${TASK_TABLE}" where "board" = ? and "status" = ? and "deleted_at" is null and "id" <> ? order by "position" asc, "created_at" asc, "id" asc`,
        [board, status, exceptId],
      ),
    )

  const writePositions = async (tx: SqlRunner, changes: ReadonlyArray<{ id: string; position: number }>) => {
    if (changes.length === 0) return
    await tx.raw(
      `update "${TASK_TABLE}" as t set "position" = v."position" from (values ${changes.map(() => "(?, ?::integer)").join(", ")}) as v("id", "position") where t."id" = v."id" and t."board" = ? and t."deleted_at" is null`,
      [...changes.flatMap((c) => [c.id, c.position]), board],
    )
  }

  const endOfColumn = `(select coalesce(max("position"), -1) + 1 from "${TASK_TABLE}" where "board" = ? and "status" = ? and "deleted_at" is null and "id" <> ?)`

  const taskWhere = (q: TaskQuery): { sql: string; bindings: unknown[] } => {
    const parts: string[] = [`"board" = ?`, `"deleted_at" is null`]
    const bindings: unknown[] = [board]
    if (q.statuses && q.statuses.length > 0) {
      parts.push(`"status" in (${list(q.statuses.length)})`)
      bindings.push(...q.statuses)
    }
    if (q.priorities && q.priorities.length > 0) {
      parts.push(`"priority" in (${list(q.priorities.length)})`)
      bindings.push(...q.priorities)
    }
    if (q.assigneeId) {
      parts.push(`"assignee_id" = ?`)
      bindings.push(q.assigneeId)
    }
    if (q.assignee) {
      parts.push(`lower("assignee") = lower(?)`)
      bindings.push(q.assignee)
    }
    if (q.unassigned) parts.push(`"assignee_id" is null and coalesce(btrim("assignee"), '') = ''`)
    if (q.tag) {
      parts.push(`"tags" @> ?::jsonb`)
      bindings.push(JSON.stringify([q.tag]))
    }
    if (q.like) {
      parts.push(`("title" ilike ? or coalesce("description", '') ilike ? or coalesce("assignee", '') ilike ?)`)
      bindings.push(q.like, q.like, q.like)
    }
    if (q.link) {
      parts.push(
        `exists (select 1 from "${LINK_TABLE}" l where l."task_id" = "${TASK_TABLE}"."id" and l."board" = ? and l."entity_type" = ? and l."entity_id" = ? and l."deleted_at" is null)`,
      )
      bindings.push(board, q.link.type, q.link.id)
    }
    return { sql: parts.join(" and "), bindings }
  }

  return {
    board,

    async boardTasks(openLimit, closedLimit) {
      const open = rowsOf<TaskRow>(
        await sql.raw(
          `select * from "${TASK_TABLE}" where "board" = ? and "deleted_at" is null and "status" not in (${CLOSED_SQL})
           order by ${STATUS_ORDER} asc, "position" asc, "created_at" asc, "id" asc limit ?`,
          [board, openLimit],
        ),
      )
      const closed: TaskRow[] = []
      for (const status of CLOSED_STATUSES) {
        closed.push(
          ...rowsOf<TaskRow>(
            await sql.raw(
              `select * from "${TASK_TABLE}" where "board" = ? and "deleted_at" is null and "status" = ?
               order by coalesce("completed_at", "updated_at") desc, "id" desc limit ?`,
              [board, status, closedLimit],
            ),
          ),
        )
      }
      return [...open, ...closed]
    },

    async listTasks(q) {
      const where = taskWhere(q)
      const rows = rowsOf<TaskRow>(
        await sql.raw(`select * from "${TASK_TABLE}" where ${where.sql} order by ${STATUS_ORDER} asc, "position" asc, "created_at" asc, "id" asc limit ? offset ?`, [
          ...where.bindings,
          q.limit,
          q.offset,
        ]),
      )
      const [count] = rowsOf<{ count: number | string }>(await sql.raw(`select count(*)::int as "count" from "${TASK_TABLE}" where ${where.sql}`, where.bindings))
      return { rows, count: Number(count?.count ?? rows.length) }
    },

    async statusCounts(dayStart) {
      return rowsOf<StatusCountRow>(
        await sql.raw(
          `select "status", count(*)::int as "count",
             (count(*) filter (where "due_date" < ? and "status" in (${OPEN_SQL})))::int as "overdue",
             (count(*) filter (where "priority" in (${URGENT_SQL}) and "status" in (${OPEN_SQL})))::int as "urgent",
             (count(*) filter (where "assignee_id" is null and coalesce(btrim("assignee"), '') = '' and "status" in (${OPEN_SQL})))::int as "unassigned"
           from "${TASK_TABLE}" where "board" = ? and "deleted_at" is null group by "status"`,
          [dayStart, board],
        ),
      ).map((r) => ({
        status: r.status,
        count: Number(r.count) || 0,
        overdue: Number(r.overdue) || 0,
        urgent: Number(r.urgent) || 0,
        unassigned: Number(r.unassigned) || 0,
      }))
    },

    async getTask(id) {
      const [row] = rowsOf<TaskRow>(await sql.raw(`select * from "${TASK_TABLE}" where "id" = ? and "board" = ? and "deleted_at" is null`, [id, board]))
      return row ?? null
    },

    async commentCounts(taskIds) {
      const out = new Map<string, number>()
      if (taskIds.length === 0) return out
      const rows = rowsOf<{ task_id: string; count: number | string }>(
        await sql.raw(
          `select "task_id", count(*)::int as "count" from "${COMMENT_TABLE}" where "board" = ? and "deleted_at" is null and "task_id" in (${list(taskIds.length)}) group by "task_id"`,
          [board, ...taskIds],
        ),
      )
      for (const r of rows) out.set(r.task_id, Number(r.count) || 0)
      return out
    },

    async insertTask(task, links, activity) {
      return inTransaction(sql, async (tx) => {
        await lockBoard(tx)
        const row: Record<string, unknown> = { ...task, board, updated_at: task.updated_at ?? task.created_at }
        const v = valuesOf(TASK_INSERT_COLUMNS, row)
        const explicit = typeof task.position === "number" && Number.isFinite(task.position)
        const [created] = rowsOf<TaskRow>(
          await tx.raw(
            `insert into "${TASK_TABLE}" (${TASK_INSERT_COLUMNS.map((c) => `"${c}"`).join(", ")}, "position") values (${v.sql.slice(1, -1)}, ${explicit ? "?" : endOfColumn}) returning *`,
            [...v.bindings, ...(explicit ? [Math.max(0, Math.floor(task.position as number))] : [board, task.status, task.id])],
          ),
        )
        const q = insertMany(
          LINK_TABLE,
          LINK_COLUMNS,
          links.map((l) => ({ ...l, board, task_id: created.id, updated_at: l.created_at })),
        )
        const linkRows = q ? rowsOf<LinkRow>(await tx.raw(q.sql, q.bindings)) : []
        await insertActivity(tx, activity)
        return { task: created, links: linkRows }
      })
    },

    async updateTask(id, plan, now) {
      return inTransaction(sql, async (tx) => {
        const before = await lockedTask(tx, id)
        if (!before) return null
        const p = plan(before)
        if (!p) return { before, after: before }
        const set = setClause(p.patch as Record<string, unknown>, TASK_PATCHABLE)
        const statusChanged = typeof p.patch.status === "string" && p.patch.status !== before.status
        if (!set.sql && p.activity.length === 0) return { before, after: before }
        let after = before
        if (set.sql) {
          if (statusChanged) await lockBoard(tx)
          const assignments = [set.sql, statusChanged ? `"position" = ${endOfColumn}` : "", `"updated_at" = ?`].filter(Boolean).join(", ")
          const bindings = [...set.bindings, ...(statusChanged ? [board, p.patch.status, id] : []), now, id, board]
          ;[after] = rowsOf<TaskRow>(await tx.raw(`update "${TASK_TABLE}" set ${assignments} where "id" = ? and "board" = ? and "deleted_at" is null returning *`, bindings))
          if (statusChanged) {
            const left = await column(tx, before.status, id)
            await writePositions(tx, positionChanges(left, left.map((r) => r.id)))
          }
        }
        await insertActivity(tx, p.activity)
        return { before, after: after ?? before }
      })
    },

    async moveTask(id, target, plan, now) {
      return inTransaction(sql, async (tx) => {
        await lockBoard(tx)
        const before = await lockedTask(tx, id)
        if (!before) return null
        const p = plan(before)
        const dest = await column(tx, target.status, id)
        const order = planMove(
          dest.map((r) => r.id),
          id,
          { afterId: target.afterId, beforeId: target.beforeId },
        )
        const others = positionChanges(dest, order).filter((c) => c.id !== id)
        const position = order.indexOf(id)
        const statusChanged = target.status !== before.status
        const set = setClause({ ...(p.patch as Record<string, unknown>), status: target.status }, TASK_PATCHABLE)
        const [after] = rowsOf<TaskRow>(
          await tx.raw(`update "${TASK_TABLE}" set ${set.sql}, "position" = ?${statusChanged ? `, "updated_at" = ?` : ""} where "id" = ? and "board" = ? and "deleted_at" is null returning *`, [
            ...set.bindings,
            position,
            ...(statusChanged ? [now] : []),
            id,
            board,
          ]),
        )
        await writePositions(tx, others)
        if (statusChanged) {
          const left = await column(tx, before.status, id)
          await writePositions(tx, positionChanges(left, left.map((r) => r.id)))
        }
        await insertActivity(tx, p.activity)
        return { before, after: after ?? before }
      })
    },

    async deleteTask(id, activity, now) {
      return inTransaction(sql, async (tx) => {
        const [row] = rowsOf<TaskRow>(
          await tx.raw(`update "${TASK_TABLE}" set "deleted_at" = ?, "updated_at" = ? where "id" = ? and "board" = ? and "deleted_at" is null returning *`, [now, now, id, board]),
        )
        if (!row) return null
        for (const table of [COMMENT_TABLE, LINK_TABLE, ACTIVITY_TABLE]) {
          await tx.raw(`update "${table}" set "deleted_at" = ? where "task_id" = ? and "board" = ? and "deleted_at" is null`, [now, id, board])
        }
        await insertActivity(tx, activity)
        const left = await column(tx, row.status, id)
        await writePositions(tx, positionChanges(left, left.map((r) => r.id)))
        return row
      })
    },

    async listComments(taskId) {
      return rowsOf<CommentRow>(
        await sql.raw(`select * from "${COMMENT_TABLE}" where "task_id" = ? and "board" = ? and "deleted_at" is null order by "created_at" asc, "id" asc`, [taskId, board]),
      )
    },

    async getComment(id) {
      const [row] = rowsOf<CommentRow>(await sql.raw(`select * from "${COMMENT_TABLE}" where "id" = ? and "board" = ? and "deleted_at" is null`, [id, board]))
      return row ?? null
    },

    async insertComment(comment, activity) {
      return inTransaction(sql, async (tx) => {
        const v = valuesOf(COMMENT_COLUMNS, { ...comment, board, updated_at: comment.created_at })
        const [row] = rowsOf<CommentRow>(
          await tx.raw(
            `insert into "${COMMENT_TABLE}" (${COMMENT_COLUMNS.map((c) => `"${c}"`).join(", ")})
             select ${v.sql.slice(1, -1)}
             where exists (select 1 from "${TASK_TABLE}" where "id" = ? and "board" = ? and "deleted_at" is null)
             returning *`,
            [...v.bindings, comment.task_id, board],
          ),
        )
        if (!row) return null
        await insertActivity(tx, activity)
        return row
      })
    },

    async updateComment(id, body, now) {
      const [row] = rowsOf<CommentRow>(
        await sql.raw(
          `update "${COMMENT_TABLE}" set "body" = ?, "edited_at" = ?, "updated_at" = ?, "metadata" = case when "metadata" is null then null else "metadata" - 'sample' end
           where "id" = ? and "board" = ? and "deleted_at" is null returning *`,
          [body, now, now, id, board],
        ),
      )
      return row ?? null
    },

    async deleteComment(id, now) {
      const [row] = rowsOf<CommentRow>(
        await sql.raw(`update "${COMMENT_TABLE}" set "deleted_at" = ?, "updated_at" = ? where "id" = ? and "board" = ? and "deleted_at" is null returning *`, [now, now, id, board]),
      )
      return row ?? null
    },

    async listActivity(taskId, limit) {
      return rowsOf<ActivityRow>(
        await sql.raw(`select * from "${ACTIVITY_TABLE}" where "task_id" = ? and "board" = ? and "deleted_at" is null order by "created_at" desc, "id" desc limit ?`, [
          taskId,
          board,
          limit,
        ]),
      )
    },

    async boardActivity(limit) {
      return rowsOf<BoardActivityRow>(
        await sql.raw(
          `select a.*, t."title" as "task_title" from "${ACTIVITY_TABLE}" a
           join "${TASK_TABLE}" t on t."id" = a."task_id" and t."board" = a."board"
           where a."board" = ? and a."deleted_at" is null and (t."deleted_at" is null or a."type" = 'task_deleted')
           order by a."created_at" desc, a."id" desc limit ?`,
          [board, limit],
        ),
      )
    },

    async apiKeyActivity() {
      const [row] = rowsOf<{ count: number | string; last: Date | string | null }>(
        await sql.raw(`select count(*)::int as "count", max("created_at") as "last" from "${ACTIVITY_TABLE}" where "board" = ? and "actor_type" = 'api-key' and "deleted_at" is null`, [board]),
      )
      return { count: Number(row?.count ?? 0) || 0, last: row?.last ?? null }
    },

    async listLinks(taskIds) {
      if (taskIds.length === 0) return []
      return rowsOf<LinkRow>(
        await sql.raw(`select * from "${LINK_TABLE}" where "board" = ? and "deleted_at" is null and "task_id" in (${list(taskIds.length)}) order by "created_at" asc, "id" asc`, [
          board,
          ...taskIds,
        ]),
      )
    },

    async insertLink(link, activity) {
      return inTransaction(sql, async (tx) => {
        const v = valuesOf(LINK_COLUMNS, { ...link, board, updated_at: link.created_at })
        const [row] = rowsOf<LinkRow>(
          await tx.raw(
            `insert into "${LINK_TABLE}" (${LINK_COLUMNS.map((c) => `"${c}"`).join(", ")})
             select ${v.sql.slice(1, -1)}
             where exists (select 1 from "${TASK_TABLE}" where "id" = ? and "board" = ? and "deleted_at" is null)
             on conflict ("task_id", "entity_type", "entity_id") where "deleted_at" is null do nothing
             returning *`,
            [...v.bindings, link.task_id, board],
          ),
        )
        if (row) {
          await insertActivity(tx, activity)
          return { link: row, created: true }
        }
        const [existing] = rowsOf<LinkRow>(
          await tx.raw(
            `select l.* from "${LINK_TABLE}" l join "${TASK_TABLE}" t on t."id" = l."task_id" and t."board" = l."board" and t."deleted_at" is null
             where l."task_id" = ? and l."board" = ? and l."entity_type" = ? and l."entity_id" = ? and l."deleted_at" is null`,
            [link.task_id, board, link.entity_type, link.entity_id],
          ),
        )
        return existing ? { link: existing, created: false } : null
      })
    },

    async deleteLink(taskId, linkId, activity, now) {
      return inTransaction(sql, async (tx) => {
        const [row] = rowsOf<LinkRow>(
          await tx.raw(
            `update "${LINK_TABLE}" set "deleted_at" = ?, "updated_at" = ?
             where "id" = ? and "task_id" = ? and "board" = ? and "deleted_at" is null
               and exists (select 1 from "${TASK_TABLE}" where "id" = ? and "board" = ? and "deleted_at" is null)
             returning *`,
            [now, now, linkId, taskId, board, taskId, board],
          ),
        )
        if (!row) return null
        await insertActivity(tx, activity)
        return row
      })
    },

    async tasksForEntity(type, entityId, limit) {
      const where = `t."board" = ? and t."deleted_at" is null and exists (select 1 from "${LINK_TABLE}" l where l."task_id" = t."id" and l."board" = ? and l."entity_type" = ? and l."entity_id" = ? and l."deleted_at" is null)`
      const bindings = [board, board, type, entityId]
      const rows = rowsOf<TaskRow>(
        await sql.raw(
          `select t.* from "${TASK_TABLE}" t where ${where}
           order by (case when t."status" in (${CLOSED_SQL}) then 1 else 0 end) asc, t."updated_at" desc, t."id" desc limit ?`,
          [...bindings, limit],
        ),
      )
      const [count] = rowsOf<{ count: number | string }>(await sql.raw(`select count(*)::int as "count" from "${TASK_TABLE}" t where ${where}`, bindings))
      return { rows, count: Number(count?.count ?? rows.length) }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface SettingStore {
  get(key: string): Promise<SettingRow | null>
  put(key: string, value: unknown, updatedBy: string | null, now: Date): Promise<SettingRow | null>
}

export function createSettingStore(sql: SqlRunner, newId: (prefix: string) => string): SettingStore {
  return {
    async get(key) {
      const [row] = rowsOf<SettingRow>(await sql.raw(`select * from "${SETTING_TABLE}" where "key" = ? and "deleted_at" is null`, [key]))
      return row ?? null
    },

    async put(key, value, updatedBy, now) {
      const [row] = rowsOf<SettingRow>(
        await sql.raw(
          `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at") values (?, ?, ?::jsonb, ?, ?, ?)
           on conflict ("key") do update set "value" = excluded."value", "updated_by" = excluded."updated_by", "updated_at" = excluded."updated_at", "deleted_at" = null
           returning *`,
          [newId("tset"), key, JSON.stringify(value ?? null), updatedBy, now, now],
        ),
      )
      return row ?? null
    },
  }
}

/* ------------------------------------------------------------------ */
/* The sandbox board                                                   */
/* ------------------------------------------------------------------ */

export interface SandboxSeed {
  tasks: TaskInsert[]
  comments: CommentInsert[]
  activity: ActivityInsert[]
  links: LinkInsert[]
}

export interface SandboxStore {
  /** Replaces everything on the sandbox board with the seed and records the marker, in one transaction. */
  replace(seed: SandboxSeed, marker: { key: string; id: string; value: unknown }, now: Date): Promise<void>
  countTasks(): Promise<number>
}

/** The only writes across a whole board, and only ever of the sandbox board. */
export function createSandboxStore(sql: SqlRunner): SandboxStore {
  const board = SANDBOX_BOARD
  return {
    async replace(seed, marker, now) {
      await inTransaction(sql, async (tx) => {
        await tx.raw(`select pg_advisory_xact_lock(hashtext(?))`, [boardLockKey(board)])
        for (const table of [LINK_TABLE, ACTIVITY_TABLE, COMMENT_TABLE, TASK_TABLE]) {
          await tx.raw(`delete from "${table}" where "board" = ?`, [board])
        }
        const tasks = insertMany(
          TASK_TABLE,
          [...TASK_INSERT_COLUMNS, "position"],
          seed.tasks.map((t) => ({ ...t, board, updated_at: t.updated_at ?? t.created_at, position: t.position ?? 0 })),
        )
        if (tasks) await tx.raw(tasks.sql, tasks.bindings)
        const comments = insertMany(
          COMMENT_TABLE,
          COMMENT_COLUMNS,
          seed.comments.map((c) => ({ ...c, board, updated_at: c.created_at })),
        )
        if (comments) await tx.raw(comments.sql, comments.bindings)
        const activity = insertMany(
          ACTIVITY_TABLE,
          ACTIVITY_COLUMNS,
          seed.activity.map((a) => ({ ...a, board, updated_at: a.created_at })),
        )
        if (activity) await tx.raw(activity.sql, activity.bindings)
        const links = insertMany(
          LINK_TABLE,
          LINK_COLUMNS,
          seed.links.map((l) => ({ ...l, board, updated_at: l.created_at })),
        )
        if (links) await tx.raw(links.sql, links.bindings)
        await tx.raw(
          `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at") values (?, ?, ?::jsonb, null, ?, ?)
           on conflict ("key") do update set "value" = excluded."value", "updated_at" = excluded."updated_at", "deleted_at" = null`,
          [marker.id, marker.key, JSON.stringify(marker.value ?? null), now, now],
        )
      })
    },

    async countTasks() {
      const [row] = rowsOf<{ count: number | string }>(await sql.raw(`select count(*)::int as "count" from "${TASK_TABLE}" where "board" = ? and "deleted_at" is null`, [board]))
      return Number(row?.count ?? 0) || 0
    },
  }
}
