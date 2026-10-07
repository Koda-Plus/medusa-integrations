/**
 * The SQL of the stores, statement by statement, against a recording runner:
 * every statement a board store sends is bound to its board, and only the
 * sandbox store writes across a whole board, the sandbox one.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createBoardStore, createSandboxStore, createSettingStore, setClause, TASK_PATCHABLE, boardLockKey, type BoardStore } from "../src/modules/tasks/lib/store.ts"
import { recorder, type Recorded, type Row } from "./helpers.ts"

const NOW = new Date("2026-10-07T12:00:00Z")

/** Plausible answers, so every method runs to its end. */
function answer(sql: string, bindings: unknown[]): Row[] {
  const task = { id: "task_1", board: "sandbox", title: "T", status: "todo", priority: "medium", position: 0, created_at: NOW, updated_at: NOW, deleted_at: null, metadata: null }
  if (/^select pg_advisory_xact_lock/.test(sql)) return []
  if (/select \* from "tasks_task" where "id" = \?/.test(sql)) return [{ ...task, id: bindings[0] }]
  if (/select "id", "position", "created_at"/.test(sql)) return [{ id: "task_2", position: 3, created_at: NOW }, { id: "task_3", position: 7, created_at: NOW }]
  if (/^update "tasks_task" set/.test(sql) && /returning \*/.test(sql)) return [task]
  if (/^insert into "tasks_task"/.test(sql)) return [task]
  if (/^insert into "tasks_comment"/.test(sql)) return [{ id: "tcom_1", task_id: "task_1", board: "sandbox" }]
  if (/^insert into "tasks_link"/.test(sql)) return []
  if (/^update "tasks_link"/.test(sql)) return [{ id: "tlnk_1" }]
  if (/count\(\*\)/.test(sql)) return [{ count: 2, last: NOW }]
  return []
}

async function exercise(store: BoardStore): Promise<void> {
  await store.boardTasks(1000, 100)
  await store.listTasks({ statuses: ["todo"], priorities: ["high"], assigneeId: "user_1", assignee: "Anna", unassigned: true, tag: "x", like: "%a%", link: { type: "order", id: "order_1" }, limit: 10, offset: 0 })
  await store.statusCounts(NOW)
  await store.getTask("task_1")
  await store.commentCounts(["task_1", "task_2"])
  await store.insertTask(
    { id: "task_9", title: "New", description: null, status: "todo", priority: "low", assignee: null, assignee_id: null, due_date: null, tags: ["a"], completed_at: null, created_by: "Anna", created_by_id: null, metadata: null, created_at: NOW },
    [{ id: "tlnk_9", task_id: "task_9", entity_type: "order", entity_id: "order_1", created_by: null, created_by_id: null, created_at: NOW }],
    [{ id: "tact_9", task_id: "task_9", type: "task_created", message: null, actor: null, actor_id: null, actor_type: "user", metadata: null, created_at: NOW }],
  )
  await store.updateTask("task_1", () => ({ patch: { status: "done", title: "Renamed", tags: ["b"] }, activity: [] }), NOW)
  await store.moveTask("task_1", { status: "review", beforeId: "task_3", afterId: null }, () => ({ patch: { completed_at: null }, activity: [] }), NOW)
  await store.deleteTask("task_1", [], NOW)
  await store.listComments("task_1")
  await store.getComment("tcom_1")
  await store.insertComment(
    { id: "tcom_2", task_id: "task_1", body: "Hi", author: null, author_role: "claude", author_id: "apk_1", author_type: "api-key", metadata: null, created_at: NOW },
    [{ id: "tact_10", task_id: "task_1", type: "commented", message: null, actor: null, actor_id: null, actor_type: "api-key", metadata: { comment_id: "tcom_2" }, created_at: NOW }],
  )
  await store.updateComment("tcom_1", "Edited", NOW)
  await store.deleteComment("tcom_1", NOW)
  await store.listActivity("task_1", 50)
  await store.boardActivity(20)
  await store.apiKeyActivity()
  await store.listLinks(["task_1"])
  await store.insertLink({ id: "tlnk_2", task_id: "task_1", entity_type: "product", entity_id: "prod_1", created_by: null, created_by_id: null, created_at: NOW }, [])
  await store.deleteLink("task_1", "tlnk_1", [], NOW)
  await store.tasksForEntity("order", "order_1", 10)
}

function assertBound(log: Recorded[], board: string, other: string) {
  assert.ok(log.length > 40, `exercised ${log.length} statements`)
  for (const { sql, bindings } of log) {
    if (/pg_advisory_xact_lock/.test(sql)) {
      assert.deepEqual(bindings, [boardLockKey(board)])
      continue
    }
    assert.ok(/"tasks_(task|comment|activity|link)"/.test(sql), `only the module's tables: ${sql.slice(0, 60)}`)
    assert.ok(bindings.includes(board), `bound to ${board}: ${sql.slice(0, 80)}`)
    assert.ok(!bindings.includes(other), `never ${other}: ${sql.slice(0, 80)}`)
    if (/^(select|update|delete)/i.test(sql.trim()) || /where exists/.test(sql)) assert.match(sql, /"board" = \?/, `filters by board: ${sql.slice(0, 80)}`)
    if (/^insert/i.test(sql.trim())) assert.match(sql, /"board"/, `writes the board: ${sql.slice(0, 80)}`)
  }
}

test("board store: every statement of every method is bound to its own board (sandbox)", async () => {
  const sql = recorder(answer)
  await exercise(createBoardStore(sql, "sandbox"))
  assertBound(sql.log, "sandbox", "main")
})

test("board store: and the same for the main board", async () => {
  const sql = recorder((s, b) => answer(s, b).map((r) => (r.board ? { ...r, board: "main" } : r)))
  await exercise(createBoardStore(sql, "main"))
  assertBound(sql.log, "main", "sandbox")
})

test("board store: comments and links are written only for a task of the board, in the same statement", async () => {
  const sql = recorder(answer)
  const store = createBoardStore(sql, "sandbox")
  await store.insertComment({ id: "c", task_id: "task_1", body: "b", author: null, author_role: "client", author_id: null, author_type: "user", metadata: null, created_at: NOW }, [])
  await store.insertLink({ id: "l", task_id: "task_1", entity_type: "order", entity_id: "order_1", created_by: null, created_by_id: null, created_at: NOW }, [])
  const [comment, link] = sql.log.filter((r) => /^insert/.test(r.sql))
  assert.match(comment.sql, /select [?, :a-z]+\s+where exists \(select 1 from "tasks_task" where "id" = \? and "board" = \? and "deleted_at" is null\)/)
  assert.deepEqual(comment.bindings.slice(-2), ["task_1", "sandbox"])
  assert.match(link.sql, /on conflict \("task_id", "entity_type", "entity_id"\) where "deleted_at" is null do nothing/)
})

test("board store: a move renumbers both columns in one transaction under the board's lock", async () => {
  const sql = recorder(answer)
  await createBoardStore(sql, "sandbox").moveTask("task_1", { status: "review", beforeId: "task_3", afterId: null }, () => ({ patch: {}, activity: [] }), NOW)
  const kinds = sql.log.map((r) => r.sql.split(" ").slice(0, 3).join(" "))
  assert.equal(kinds[0], "select pg_advisory_xact_lock(hashtext(?))")
  const moved = sql.log.find((r) => /^update "tasks_task" set "status" = \?/.test(r.sql) || /^update "tasks_task" set "completed_at"/.test(r.sql))
  assert.ok(moved, "the moving task is updated with its new status and position")
  const renumbers = sql.log.filter((r) => /from \(values/.test(r.sql))
  assert.ok(renumbers.length >= 1, "neighbours renumbered")
  for (const r of renumbers) assert.match(r.sql, /where t\."id" = v\."id" and t\."board" = \? and t\."deleted_at" is null$/)
})

test("sandbox store: replaces only the sandbox board", async () => {
  const sql = recorder()
  const store = createSandboxStore(sql)
  await store.replace(
    {
      tasks: [{ id: "task_sbx_01", title: "T", description: null, status: "todo", priority: "low", assignee: null, assignee_id: null, due_date: null, tags: null, completed_at: null, created_by: null, created_by_id: null, metadata: { sample: {} }, created_at: NOW, position: 0 }],
      comments: [],
      activity: [],
      links: [],
    },
    { key: "sandbox:seed", id: "tset_1", value: { version: "x" } },
    NOW,
  )
  await store.countTasks()
  const deletes = sql.log.filter((r) => /^delete/.test(r.sql))
  assert.deepEqual(
    deletes.map((d) => [d.sql, d.bindings]),
    ["tasks_link", "tasks_activity", "tasks_comment", "tasks_task"].map((t) => [`delete from "${t}" where "board" = ?`, ["sandbox"]]),
  )
  for (const r of sql.log) assert.ok(!r.bindings.includes("main"), r.sql)
  assert.deepEqual(sql.log[0].bindings, [boardLockKey("sandbox")])
})

test("settings store and set clauses: whitelisted columns only, JSON as jsonb", async () => {
  const set = setClause({ title: "x", tags: ["a"], board: "main", id: "evil", position: 99 }, TASK_PATCHABLE)
  assert.equal(set.sql, `"title" = ?, "tags" = ?::jsonb`)
  assert.deepEqual(set.bindings, ["x", '["a"]'])
  const sql = recorder()
  await createSettingStore(sql, () => "tset_x").put("sandbox:seed", { a: 1 }, null, NOW)
  assert.match(sql.log[0].sql, /on conflict \("key"\) do update/)
  assert.deepEqual(sql.log[0].bindings.slice(0, 3), ["tset_x", "sandbox:seed", '{"a":1}'])
})
