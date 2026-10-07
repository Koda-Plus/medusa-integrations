/**
 * Taking over the KODA Panel module's rows: the shape check over catalog
 * rows of every known copy of that module, the SQL the migration sends,
 * and the migration itself with the catalog read stubbed. No database.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ADOPTED_FROM, adoptionStatements, isRunToken, legacyShape, newRunToken, type ColumnInfo } from "../src/modules/tasks/lib/legacy.ts"
import { CREATE_STATEMENTS } from "../src/modules/tasks/lib/schema.ts"
import { Migration20261007140000 } from "../src/modules/tasks/migrations/Migration20261007140000.ts"

const TS = "timestamp with time zone"
const cols = (table: string, spec: Record<string, string>): ColumnInfo[] => Object.entries(spec).map(([column, type]) => ({ table, column, type }))

/* koda-plus-demo and stonerchef: tags jsonb, activity metadata, nullable author. */
const DEMO: ColumnInfo[] = [
  ...cols("task", { id: "text", title: "text", description: "text", status: "text", priority: "text", assignee: "text", due_date: TS, tags: "jsonb", position: "integer", created_at: TS, updated_at: TS, deleted_at: TS }),
  ...cols("task_comment", { id: "text", body: "text", author: "text", author_role: "text", task_id: "text", created_at: TS, updated_at: TS, deleted_at: TS }),
  ...cols("activity_log", { id: "text", type: "text", message: "text", actor: "text", metadata: "jsonb", task_id: "text", created_at: TS, updated_at: TS, deleted_at: TS }),
]

/* biolcheck and biodent: a single category instead of tags, no activity metadata. */
const CLIENT: ColumnInfo[] = [
  ...cols("task", { id: "text", title: "text", description: "text", status: "text", priority: "text", category: "text", assignee: "text", due_date: TS, position: "integer", created_at: TS, updated_at: TS, deleted_at: TS }),
  ...cols("task_comment", { id: "text", body: "text", author: "text", author_role: "text", task_id: "text", created_at: TS, updated_at: TS, deleted_at: TS }),
  ...cols("activity_log", { id: "text", type: "text", message: "text", actor: "text", task_id: "text", created_at: TS, updated_at: TS, deleted_at: TS }),
]

const RUN = "adopt_test_run1"

/** A statement that changes one of the old tables in any way. */
const TOUCHES_LEGACY = /\b(drop|alter|truncate|rename)\b[^;]*"(task|task_comment|activity_log)"|\b(delete\s+from|update)\s+"(task|task_comment|activity_log)"|\binsert\s+into\s+"(task|task_comment|activity_log)"/i

test("shape: every known copy of the KODA Panel module is recognised, with its optional columns", () => {
  const demo = legacyShape(DEMO)
  assert.deepEqual(demo, { found: true, ok: true, reason: null, task: { tags: true, category: false }, activity: { metadata: true } })
  const client = legacyShape(CLIENT)
  assert.deepEqual(client, { found: true, ok: true, reason: null, task: { tags: false, category: true }, activity: { metadata: false } })
})

test("shape: nothing to adopt on a fresh database", () => {
  const shape = legacyShape([])
  assert.equal(shape.found, false)
  assert.equal(shape.ok, false)
  assert.deepEqual(adoptionStatements(shape, RUN), [])
})

test("shape: another module's table called task is not the KODA Panel's", () => {
  const foreign = legacyShape(cols("task", { id: "text", name: "text", done: "boolean", created_at: TS }))
  assert.equal(foreign.found, true)
  assert.equal(foreign.ok, false)
  assert.match(foreign.reason ?? "", /"task" has no "title", "description", "status", "priority", "assignee", "due_date", "position", "updated_at", "deleted_at"/)
})

test("shape: a missing companion table or an unexpected type stops the copy, with the reason", () => {
  const noComments = legacyShape(DEMO.filter((c) => c.table !== "task_comment"))
  assert.equal(noComments.ok, false)
  assert.equal(noComments.reason, 'table "task_comment" is missing')
  const textPosition = legacyShape(DEMO.map((c) => (c.table === "task" && c.column === "position" ? { ...c, type: "text" } : c)))
  assert.equal(textPosition.ok, false)
  assert.match(textPosition.reason ?? "", /unexpected types in "position" \(text\)/)
  const textDates = legacyShape(DEMO.map((c) => (c.table === "activity_log" && c.column === "created_at" ? { ...c, type: "character varying(30)" } : c)))
  assert.match(textDates.reason ?? "", /"activity_log" has unexpected types in "created_at" \(charactervarying30\)/, "catalog text is reduced to plain characters")
  assert.equal(legacyShape(DEMO.map((c) => (c.column === "position" ? { ...c, type: "numeric(10,2)" } : c))).ok, true, "a numeric position is cast")
  assert.equal(legacyShape(DEMO.map((c) => (c.column === "status" ? { ...c, type: "task_status_enum" } : c))).ok, true, "an enum status reads as text")
})

test("skipped: only a marker that says why, nothing copied", () => {
  const shape = legacyShape(cols("task", { id: "text", name: "text" }))
  const sql = adoptionStatements(shape, RUN)
  assert.equal(sql.length, 1)
  assert.match(sql[0], /^insert into "tasks_setting"/)
  assert.match(sql[0], /'skipped'/)
  assert.match(sql[0], /where not exists \(select 1 from "tasks_setting" where "key" = 'legacy:adoption'\)/)
  assert.doesNotMatch(sql[0], /tasks_task/)
})

test("adoption: a marker first, guarded by four empty tables; then tasks, comments and activity; then the counts", () => {
  const sql = adoptionStatements(legacyShape(DEMO), RUN)
  assert.equal(sql.length, 5)
  const [marker, tasks, comments, activity, counts] = sql
  for (const table of ["tasks_task", "tasks_comment", "tasks_activity", "tasks_link"]) assert.ok(marker.includes(`not exists (select 1 from "${table}")`), `marker guarded by an empty ${table}`)
  assert.match(marker, /'run', 'adopt_test_run1'/)
  assert.match(marker, /'source_tasks', \(select count\(\*\) from "task"\)/)
  for (const s of [tasks, comments, activity]) {
    assert.match(s, /where exists \(select 1 from "tasks_setting" s where s\."key" = 'legacy:adoption' and s\."value"->>'run' = 'adopt_test_run1'\)/, "copies only under this run's marker")
    assert.match(s, /on conflict \("id"\) do nothing;$/, "ids already there are skipped")
    assert.match(s, /'main'/, "everything lands on the main board")
    assert.ok(s.includes(`'adopted_from', '${ADOPTED_FROM}'`), "every row is marked as adopted")
  }
  assert.match(tasks, /from "task" t/)
  assert.match(tasks, /"id", "board", "title"/)
  assert.match(tasks, /t\."id"::text/, "same ids")
  assert.match(tasks, /t\."deleted_at"::timestamptz/, "soft deletes kept")
  assert.match(tasks, /coalesce\(t\."created_at"::timestamptz, now\(\)\), coalesce\(t\."updated_at"::timestamptz, now\(\)\)/, "timestamps kept")
  assert.match(tasks, /jsonb_array_length\(to_jsonb\(t\."tags"\)\)/, "tags of the demo copy")
  assert.doesNotMatch(tasks, /category/)
  assert.match(comments, /from "task_comment" c/)
  assert.match(comments, /when c\."author_role"::text = 'koda' then 'claude'/, "one copy called the AI agent koda")
  assert.match(comments, /c\."task_id"::text in \(select "id" from "tasks_task"\)/, "comments only of copied tasks")
  assert.match(activity, /jsonb_typeof\(to_jsonb\(a\."metadata"\)\) = 'object'/, "metadata kept when the copy has it")
  assert.match(counts, /^update "tasks_setting" set "value" = "value" \|\| jsonb_build_object\(/)
  for (const s of sql) assert.doesNotMatch(s, TOUCHES_LEGACY, "the old tables are only read")
})

test("adoption: the client copies turn their category into a tag and have no activity metadata", () => {
  const [, tasks, , activity] = adoptionStatements(legacyShape(CLIENT), RUN)
  assert.match(tasks, /jsonb_build_array\(btrim\(t\."category"::text\)\)/)
  assert.doesNotMatch(tasks, /t\."tags"/)
  assert.doesNotMatch(activity, /a\."metadata"/)
  assert.match(activity, /jsonb_build_object\('adopted_from', 'koda-panel'\),\s+coalesce\(a\."created_at"/)
})

test("adoption: a copy with both tags and a category prefers the tags", () => {
  const both = legacyShape([...DEMO, { table: "task", column: "category", type: "text" }])
  const [, tasks] = adoptionStatements(both, RUN)
  assert.match(tasks, /coalesce\(\(case when jsonb_typeof\(to_jsonb\(t\."tags"\)\)/)
  assert.match(tasks, /jsonb_build_array\(btrim\(t\."category"::text\)\)/)
})

test("run tokens: plain characters only, since they go into the SQL text", () => {
  assert.equal(isRunToken(newRunToken(new Date("2026-10-07T14:00:00Z"), () => 0.5)), true)
  assert.match(newRunToken(new Date("2026-10-07T14:00:00Z"), () => 0.5), /^adopt_[a-z0-9]+_[a-z0-9]{6}$/)
  assert.equal(isRunToken("x'; drop table task; --"), false)
  assert.throws(() => adoptionStatements(legacyShape(DEMO), "bad token!"), /Invalid adoption run token/)
})

function migration(execute?: (sql: string) => Promise<unknown>) {
  const statements: string[] = []
  const m = Object.create(Migration20261007140000.prototype) as { addSql(s: string): void; up(): Promise<void>; down(): Promise<void>; execute?: unknown }
  m.addSql = (s: string) => statements.push(s)
  if (execute) m.execute = execute
  else m.execute = undefined
  return { m, statements }
}

test("migration: the tables first, then the adoption fitted to the catalog it read", async () => {
  const asked: string[] = []
  const { m, statements } = migration(async (sql) => {
    asked.push(sql)
    return DEMO
  })
  await m.up()
  assert.equal(asked.length, 1)
  assert.match(asked[0], /to_regclass\('"task"'\), to_regclass\('"task_comment"'\), to_regclass\('"activity_log"'\)/)
  assert.deepEqual(statements.slice(0, CREATE_STATEMENTS.length), [...CREATE_STATEMENTS])
  const adoption = statements.slice(CREATE_STATEMENTS.length)
  assert.equal(adoption.length, 5)
  assert.match(adoption[0], /^insert into "tasks_setting"/)
  for (const s of statements) assert.doesNotMatch(s, TOUCHES_LEGACY)
})

test("migration: a fresh database gets the tables only; idempotent statements everywhere", async () => {
  const fresh = migration(async () => [])
  await fresh.m.up()
  assert.deepEqual(fresh.statements, [...CREATE_STATEMENTS])
  for (const s of CREATE_STATEMENTS) assert.match(s, /^create (unique )?(table|index) if not exists/)
  const noExecute = migration()
  const warn = console.warn
  const warned: string[] = []
  console.warn = (m: string) => void warned.push(m)
  try {
    await noExecute.m.up()
  } finally {
    console.warn = warn
  }
  assert.deepEqual(noExecute.statements.slice(0, CREATE_STATEMENTS.length), [...CREATE_STATEMENTS], "a runner without execute skips the adoption")
  assert.equal(noExecute.statements.length, CREATE_STATEMENTS.length + 1, "and leaves a marker that says why")
  assert.match(noExecute.statements.at(-1) ?? "", /'skipped'.*could not read the old tables/s)
  assert.match(noExecute.statements.at(-1) ?? "", /to_regclass\('"task"'\) is not null/)
  assert.equal(warned.length, 1)
})

test("migration: the tables are namespaced, with a board everywhere and no bigNumber", () => {
  const all = CREATE_STATEMENTS.join("\n")
  for (const table of ["tasks_task", "tasks_comment", "tasks_activity", "tasks_link", "tasks_setting"]) assert.ok(all.includes(`create table if not exists "${table}"`))
  for (const table of ["tasks_task", "tasks_comment", "tasks_activity", "tasks_link"]) {
    const body = CREATE_STATEMENTS.find((s) => s.includes(`create table if not exists "${table}"`)) ?? ""
    assert.match(body, /"board" text not null default 'main'/)
  }
  assert.doesNotMatch(all, /raw_|numeric/)
  assert.doesNotMatch(all, /create table if not exists "task"\b/)
})

test("migration: down drops only the module's own tables", async () => {
  const { m, statements } = migration()
  await m.down()
  assert.deepEqual(statements, [
    'drop table if exists "tasks_link" cascade;',
    'drop table if exists "tasks_activity" cascade;',
    'drop table if exists "tasks_comment" cascade;',
    'drop table if exists "tasks_task" cascade;',
    'drop table if exists "tasks_setting" cascade;',
  ])
})
