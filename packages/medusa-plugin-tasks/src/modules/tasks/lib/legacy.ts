/**
 * ADOPTING THE KODA PANEL MODULE. Pure: the shape check and the SQL text,
 * tested with `node --test`; the migration runs them.
 *
 * Before this plugin, Koda Plus stores ran the board as app code (the
 * "KODA Panel" module) with three tables: `task`, `task_comment` and
 * `activity_log`. Its copies differ a little: some have `tags` (jsonb),
 * others a single `category`; `activity_log.metadata` exists only in newer
 * copies; one copy stores the AI agent's comments with the role `koda`
 * instead of `claude`.
 *
 * The migration reads the columns of those three tables from the catalog
 * (`LEGACY_SHAPE_SQL`). When they have the KODA Panel shape and the new
 * tables are still empty, it copies every row into the new tables, with
 * the same ids, timestamps and soft deletes, on the `main` board:
 *
 *   1. a marker row in `tasks_setting` (`legacy:adoption`), written only
 *      when the four new tables hold nothing yet, carrying a token of this
 *      run and the row counts of the old tables;
 *   2. the tasks, comments and activity, each insert guarded by "the marker
 *      of this run exists", so a second run copies nothing (and every insert
 *      also skips ids that are already there);
 *   3. the marker gets the counts of what was copied.
 *
 * The old tables are only read: never dropped, renamed or altered, so the
 * old module keeps working if it is still installed. A table named `task`
 * that is not the KODA Panel's (another module's) does not match the shape
 * and nothing is copied; the marker then says why (`skipped`).
 */

import { ACTIVITY_TABLE, ADOPTION_KEY, COMMENT_TABLE, LEGACY_ACTIVITY_TABLE, LEGACY_COMMENT_TABLE, LEGACY_TASK_TABLE, LINK_TABLE, MAIN_BOARD, SETTING_TABLE, TASK_TABLE } from "./constants"

/** Marks every adopted row (`metadata.adopted_from`). */
export const ADOPTED_FROM = "koda-panel"
/** The id of the marker row. */
export const ADOPTION_ROW_ID = "tset_legacy_adoption"

/**
 * The columns of the three old tables, resolved the way the copy resolves
 * them (`to_regclass` follows the search path, like an unqualified name).
 * A missing table contributes no rows.
 */
export const LEGACY_SHAPE_SQL = `select c."relname" as "table", a."attname" as "column", format_type(a."atttypid", a."atttypmod") as "type"
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c."oid" = a."attrelid"
where c."oid" in (to_regclass('"${LEGACY_TASK_TABLE}"'), to_regclass('"${LEGACY_COMMENT_TABLE}"'), to_regclass('"${LEGACY_ACTIVITY_TABLE}"'))
  and a."attnum" > 0 and not a."attisdropped"`

export interface ColumnInfo {
  table: string
  column: string
  type: string
}

export interface LegacyShape {
  /** The old `task` table exists (whatever its shape). */
  found: boolean
  /** The three tables have the KODA Panel shape: the rows can be copied. */
  ok: boolean
  /** Why not, when `found` and not `ok`. */
  reason: string | null
  task: { tags: boolean; category: boolean }
  activity: { metadata: boolean }
}

type Check = "any" | "time" | "number"

const TASK_COLUMNS: Record<string, Check> = {
  id: "any",
  title: "any",
  description: "any",
  status: "any",
  priority: "any",
  assignee: "any",
  due_date: "time",
  position: "number",
  created_at: "time",
  updated_at: "time",
  deleted_at: "time",
}

const COMMENT_COLUMNS: Record<string, Check> = {
  id: "any",
  task_id: "any",
  body: "any",
  author: "any",
  author_role: "any",
  created_at: "time",
  updated_at: "time",
  deleted_at: "time",
}

const ACTIVITY_COLUMNS: Record<string, Check> = {
  id: "any",
  task_id: "any",
  type: "any",
  message: "any",
  actor: "any",
  created_at: "time",
  updated_at: "time",
  deleted_at: "time",
}

function typeOk(type: string, check: Check): boolean {
  const t = type.toLowerCase()
  if (check === "time") return t.startsWith("timestamp")
  if (check === "number") return ["integer", "bigint", "smallint", "real", "double precision"].includes(t) || t.startsWith("numeric")
  return true
}

/* Names that reach SQL text come from the catalog: keep only plain identifiers. */
const safeName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "")

function tableProblem(table: string, columns: Map<string, string> | undefined, expected: Record<string, Check>): string | null {
  if (!columns) return `table "${table}" is missing`
  const missing = Object.keys(expected).filter((c) => !columns.has(c))
  if (missing.length > 0) return `"${table}" has no ${missing.map((c) => `"${c}"`).join(", ")}`
  const wrong = Object.entries(expected).filter(([c, check]) => !typeOk(columns.get(c) ?? "", check))
  if (wrong.length > 0) return `"${table}" has unexpected types in ${wrong.map(([c]) => `"${c}" (${safeName(columns.get(c) ?? "")})`).join(", ")}`
  return null
}

/** The shape of the old tables from their catalog rows. */
export function legacyShape(rows: ReadonlyArray<Partial<ColumnInfo>>): LegacyShape {
  const tables = new Map<string, Map<string, string>>()
  for (const r of rows) {
    if (typeof r?.table !== "string" || typeof r.column !== "string") continue
    const cols = tables.get(r.table) ?? new Map<string, string>()
    cols.set(r.column, typeof r.type === "string" ? r.type : "")
    tables.set(r.table, cols)
  }
  const task = tables.get(LEGACY_TASK_TABLE)
  const shape: LegacyShape = {
    found: Boolean(task),
    ok: false,
    reason: null,
    task: { tags: Boolean(task?.has("tags")), category: Boolean(task?.has("category")) },
    activity: { metadata: Boolean(tables.get(LEGACY_ACTIVITY_TABLE)?.has("metadata")) },
  }
  if (!task) return shape
  const problem =
    tableProblem(LEGACY_TASK_TABLE, task, TASK_COLUMNS) ??
    tableProblem(LEGACY_COMMENT_TABLE, tables.get(LEGACY_COMMENT_TABLE), COMMENT_COLUMNS) ??
    tableProblem(LEGACY_ACTIVITY_TABLE, tables.get(LEGACY_ACTIVITY_TABLE), ACTIVITY_COLUMNS)
  shape.ok = problem === null
  shape.reason = problem
  return shape
}

/** A run token is ours and plain: it goes into the SQL text. */
export function isRunToken(run: string): boolean {
  return /^[a-z0-9_]{6,64}$/.test(run)
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

const markerOfRun = (run: string) => `exists (select 1 from "${SETTING_TABLE}" s where s."key" = ${quote(ADOPTION_KEY)} and s."value"->>'run' = ${quote(run)})`

const adoptedMeta = `jsonb_build_object('adopted_from', ${quote(ADOPTED_FROM)})`

/** Non-empty array of tags, or null. CASE keeps `jsonb_array_length` away from anything but an array. */
const tagsExpr = (col: string) =>
  `(case when jsonb_typeof(to_jsonb(t."${col}")) = 'array' then (case when jsonb_array_length(to_jsonb(t."${col}")) > 0 then to_jsonb(t."${col}") end) end)`
const categoryExpr = (col: string) => `(case when nullif(btrim(t."${col}"::text), '') is not null then jsonb_build_array(btrim(t."${col}"::text)) end)`

function tagsSql(shape: LegacyShape): string {
  if (shape.task.tags && shape.task.category) return `coalesce(${tagsExpr("tags")}, ${categoryExpr("category")})`
  if (shape.task.tags) return tagsExpr("tags")
  if (shape.task.category) return categoryExpr("category")
  return "null"
}

/**
 * The statements of an adoption, in order. Empty when there is nothing to
 * adopt; the `skipped` marker alone when the old tables are there in another
 * shape.
 */
export function adoptionStatements(shape: LegacyShape, run: string): string[] {
  if (!shape.found) return []
  if (!isRunToken(run)) throw new Error("Invalid adoption run token")
  if (!shape.ok) {
    return [
      `insert into "${SETTING_TABLE}" ("id", "key", "value", "created_at", "updated_at")
select ${quote(ADOPTION_ROW_ID)}, ${quote(ADOPTION_KEY)}, jsonb_build_object('state', 'skipped', 'run', ${quote(run)}, 'source', ${quote(ADOPTED_FROM)}, 'reason', ${quote(shape.reason ?? "unknown shape")}, 'at', now()), now(), now()
where not exists (select 1 from "${SETTING_TABLE}" where "key" = ${quote(ADOPTION_KEY)})
on conflict do nothing;`,
    ]
  }

  const marker = `insert into "${SETTING_TABLE}" ("id", "key", "value", "created_at", "updated_at")
select ${quote(ADOPTION_ROW_ID)}, ${quote(ADOPTION_KEY)}, jsonb_build_object(
  'state', 'adopted', 'run', ${quote(run)}, 'source', ${quote(ADOPTED_FROM)}, 'at', now(),
  'source_tasks', (select count(*) from "${LEGACY_TASK_TABLE}"),
  'source_comments', (select count(*) from "${LEGACY_COMMENT_TABLE}"),
  'source_activity', (select count(*) from "${LEGACY_ACTIVITY_TABLE}")
), now(), now()
where not exists (select 1 from "${TASK_TABLE}")
  and not exists (select 1 from "${COMMENT_TABLE}")
  and not exists (select 1 from "${ACTIVITY_TABLE}")
  and not exists (select 1 from "${LINK_TABLE}")
  and not exists (select 1 from "${SETTING_TABLE}" where "key" = ${quote(ADOPTION_KEY)})
on conflict do nothing;`

  const tasks = `insert into "${TASK_TABLE}" ("id", "board", "title", "description", "status", "priority", "assignee", "assignee_id", "due_date", "tags", "position", "completed_at", "created_by", "created_by_id", "metadata", "created_at", "updated_at", "deleted_at")
select t."id"::text, ${quote(MAIN_BOARD)}, coalesce(t."title"::text, ''), t."description"::text, coalesce(t."status"::text, 'todo'), coalesce(t."priority"::text, 'medium'),
  nullif(btrim(t."assignee"::text), ''), null, t."due_date"::timestamptz, ${tagsSql(shape)}, coalesce(t."position", 0)::integer,
  (case when t."status"::text in ('done', 'rejected') then coalesce(t."updated_at"::timestamptz, now()) end), null, null, ${adoptedMeta},
  coalesce(t."created_at"::timestamptz, now()), coalesce(t."updated_at"::timestamptz, now()), t."deleted_at"::timestamptz
from "${LEGACY_TASK_TABLE}" t
where ${markerOfRun(run)}
on conflict ("id") do nothing;`

  const comments = `insert into "${COMMENT_TABLE}" ("id", "board", "task_id", "body", "author", "author_role", "author_id", "author_type", "metadata", "edited_at", "created_at", "updated_at", "deleted_at")
select c."id"::text, ${quote(MAIN_BOARD)}, c."task_id"::text, coalesce(c."body"::text, ''), nullif(btrim(c."author"::text), ''),
  (case when c."author_role"::text in ('agency', 'client', 'claude') then c."author_role"::text when c."author_role"::text = 'koda' then 'claude' else 'agency' end),
  null, null, ${adoptedMeta}, null,
  coalesce(c."created_at"::timestamptz, now()), coalesce(c."updated_at"::timestamptz, now()), c."deleted_at"::timestamptz
from "${LEGACY_COMMENT_TABLE}" c
where ${markerOfRun(run)} and c."task_id"::text in (select "id" from "${TASK_TABLE}")
on conflict ("id") do nothing;`

  const meta = shape.activity.metadata
    ? `((case when jsonb_typeof(to_jsonb(a."metadata")) = 'object' then to_jsonb(a."metadata") else '{}'::jsonb end) || ${adoptedMeta})`
    : adoptedMeta

  const activity = `insert into "${ACTIVITY_TABLE}" ("id", "board", "task_id", "type", "message", "actor", "actor_id", "actor_type", "metadata", "created_at", "updated_at", "deleted_at")
select a."id"::text, ${quote(MAIN_BOARD)}, a."task_id"::text, coalesce(a."type"::text, 'task_updated'), a."message"::text, nullif(btrim(a."actor"::text), ''), null, null, ${meta},
  coalesce(a."created_at"::timestamptz, now()), coalesce(a."updated_at"::timestamptz, now()), a."deleted_at"::timestamptz
from "${LEGACY_ACTIVITY_TABLE}" a
where ${markerOfRun(run)} and a."task_id"::text in (select "id" from "${TASK_TABLE}")
on conflict ("id") do nothing;`

  const counts = `update "${SETTING_TABLE}" set "value" = "value" || jsonb_build_object(
  'tasks', (select count(*) from "${TASK_TABLE}" where "metadata"->>'adopted_from' = ${quote(ADOPTED_FROM)}),
  'comments', (select count(*) from "${COMMENT_TABLE}" where "metadata"->>'adopted_from' = ${quote(ADOPTED_FROM)}),
  'activity', (select count(*) from "${ACTIVITY_TABLE}" where "metadata"->>'adopted_from' = ${quote(ADOPTED_FROM)})
), "updated_at" = now()
where "key" = ${quote(ADOPTION_KEY)} and "value"->>'run' = ${quote(run)};`

  return [marker, tasks, comments, activity, counts]
}

/**
 * The marker when the migration runner cannot read the catalog (no
 * `execute`): written only when a table called `task` exists, so Settings,
 * General says why nothing was copied instead of tasks silently missing.
 */
export const SKIPPED_WITHOUT_CATALOG = `insert into "${SETTING_TABLE}" ("id", "key", "value", "created_at", "updated_at")
select ${quote(ADOPTION_ROW_ID)}, ${quote(ADOPTION_KEY)}, jsonb_build_object('state', 'skipped', 'source', ${quote(ADOPTED_FROM)}, 'reason', 'the migration runner could not read the old tables', 'at', now()), now(), now()
where to_regclass('"${LEGACY_TASK_TABLE}"') is not null and not exists (select 1 from "${SETTING_TABLE}" where "key" = ${quote(ADOPTION_KEY)})
on conflict do nothing;`

/** A fresh run token: time and randomness, plain characters only. */
export function newRunToken(now: Date = new Date(), random: () => number = Math.random): string {
  return `adopt_${now.getTime().toString(36)}_${Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0")}`
}
