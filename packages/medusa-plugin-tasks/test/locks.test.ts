/**
 * THE ORDER OF LOCKS AND WHAT A BROKEN TRANSACTION ANSWERS. Every change that
 * can renumber a column takes the board's lock before any task row (a status
 * change through POST /admin/tasks/tasks/:id, a move, a delete), so two of
 * them never wait for each other the other way round. A transaction Postgres
 * breaks off for a deadlock or a serialization failure runs once more; a
 * second failure answers 409 `conflict_retry`; anything else a plain 500
 * without the exception's text. The same order on a real Postgres is in
 * `pg-scenario.ts` (lockOrder).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createBoardStore, inTransaction, isRetryable, POSITION_BATCH, type SqlRunner } from "../src/modules/tasks/lib/store.ts"
import { answer, maskedError } from "../src/api/admin/tasks/helpers.ts"
import { ActionError } from "../src/workflows/tasks/runtime.ts"
import { recorder, type Row } from "./helpers.ts"

const NOW = new Date("2026-10-07T12:00:00Z")
const task = { id: "task_1", board: "main", title: "T", status: "todo", priority: "medium", position: 0, created_at: NOW, updated_at: NOW, deleted_at: null, metadata: null }

function rows(column = 3) {
  return (sql: string): Row[] => {
    if (/select \* from "tasks_task" where "id" = \?/.test(sql)) return [task]
    if (/select "id", "position", "created_at"/.test(sql)) return Array.from({ length: column }, (_, i) => ({ id: `task_${i + 2}`, position: i * 2 + 1, created_at: NOW }))
    if (/^update "tasks_task" set/.test(sql) && /returning \*/.test(sql)) return [task]
    return []
  }
}

const first = (log: Array<{ sql: string }>, re: RegExp) => log.findIndex((r) => re.test(r.sql))

test("locks: a status change sent to POST /tasks/:id takes the board before the task's row", async () => {
  const sql = recorder(rows())
  await createBoardStore(sql, "main").updateTask("task_1", () => ({ patch: { status: "review" }, activity: [] }), NOW, true)
  const lock = first(sql.log, /pg_advisory_xact_lock/)
  const row = first(sql.log, /for update$/)
  assert.ok(lock >= 0 && row > lock, `board lock (${lock}) before the row (${row})`)
  assert.equal(sql.log.filter((r) => /pg_advisory_xact_lock/.test(r.sql)).length, 1, "taken once")
})

test("locks: a delete takes the board first and renumbers its open column; closed columns are never numbered", async () => {
  const sql = recorder(rows())
  await createBoardStore(sql, "main").deleteTask("task_1", [], NOW)
  assert.match(sql.log[0].sql, /pg_advisory_xact_lock/)
  assert.ok(sql.log.some((r) => /from \(values/.test(r.sql)), "the open column numbered again")
  assert.ok(!sql.log.some((r) => /^update "tasks_activity"/.test(r.sql)), "the task's log stays")

  const closed = recorder((s) => (/select \* from "tasks_task" where "id" = \?/.test(s) || /returning \*/.test(s) ? [{ ...task, status: "done" }] : rows()(s)))
  await createBoardStore(closed, "main").deleteTask("task_1", [], NOW)
  assert.ok(!closed.log.some((r) => /select "id", "position", "created_at"/.test(r.sql)), "a done task leaves no gap to close")
})

test("locks: a drop in a closed column changes the status only; a status change to done goes to position 0", async () => {
  const move = recorder(rows())
  await createBoardStore(move, "main").moveTask("task_1", { status: "done", beforeId: "task_3", afterId: null }, () => ({ patch: {}, activity: [] }), NOW)
  const reads = move.log.filter((r) => /select "id", "position", "created_at"/.test(r.sql))
  assert.equal(reads.length, 1, "only the column it left is read")
  assert.deepEqual(reads[0].bindings.slice(0, 2), ["main", "todo"])
  const upd = recorder(rows())
  await createBoardStore(upd, "main").updateTask("task_1", () => ({ patch: { status: "done" }, activity: [] }), NOW, true)
  const set = upd.log.find((r) => /^update "tasks_task" set/.test(r.sql))
  assert.match(set?.sql ?? "", /"position" = 0/)
})

test("locks: a long column is numbered again in batches far below the 65 535 bindings of Postgres", async () => {
  const sql = recorder(rows(POSITION_BATCH * 2 + 5))
  await createBoardStore(sql, "main").updateTask("task_1", () => ({ patch: { status: "review" }, activity: [] }), NOW, true)
  const batches = sql.log.filter((r) => /from \(values/.test(r.sql))
  assert.equal(batches.length, 3)
  for (const b of batches) assert.ok(b.bindings.length <= POSITION_BATCH * 2 + 1)
})

test("retries: a deadlock or a serialization failure runs the transaction once more, then gives up", async () => {
  let calls = 0
  const flaky = (failures: number, code = "40P01"): SqlRunner => ({
    raw: async () => ({ rows: [] }),
    async transaction(fn) {
      calls += 1
      if (calls <= failures) throw Object.assign(new Error("deadlock detected"), { code })
      return fn(this)
    },
  })
  assert.equal(await inTransaction(flaky(1), async () => "ok"), "ok")
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(inTransaction(flaky(2, "40001"), async () => "ok"), (err: unknown) => isRetryable(err))
  assert.equal(calls, 2, "exactly one retry")
  calls = 0
  await assert.rejects(inTransaction(flaky(1, "23505"), async () => "ok"), /deadlock detected/)
  assert.equal(calls, 1, "other errors are not retried")
})

function response() {
  const res = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
  }
  return res
}

test("answers: a refusal keeps its code, a broken transaction is 409 conflict_retry, anything else a plain 500 with the details in the log", async () => {
  const logged: string[] = []
  const req = { method: "POST", originalUrl: "/admin/tasks/tasks?x=1", scope: { resolve: () => ({ error: (m: string) => logged.push(m) }) } }
  const refusal = response()
  await answer(refusal as never, async () => {
    throw new ActionError(409, "sandbox_full", "Full.")
  }, 200, req as never)
  assert.deepEqual([refusal.statusCode, refusal.body.code], [409, "sandbox_full"])

  const conflict = response()
  await answer(conflict as never, async () => {
    throw Object.assign(new Error("deadlock detected"), { code: "40P01" })
  }, 200, req as never)
  assert.deepEqual([conflict.statusCode, conflict.body.code], [409, "conflict_retry"])

  const broken = response()
  await answer(broken as never, async () => {
    throw new Error(`insert into "tasks_task" ("id") values ($1) - relation "tasks_task" does not exist; key sk_${"a".repeat(20)} via postgres://admin:topsecret@localhost:5432/shop`)
  }, 200, req as never)
  assert.equal(broken.statusCode, 500)
  assert.equal(broken.body.code, "server_error")
  assert.doesNotMatch(JSON.stringify(broken.body), /tasks_task|relation|insert/, "no SQL to the browser")
  assert.equal(logged.length, 1)
  assert.match(logged[0], /POST \/admin\/tasks\/tasks failed: Error: insert into/)
  assert.doesNotMatch(logged[0], /topsecret|sk_aaaa/, "secrets masked in the log")
  assert.match(maskedError(new Error("Bearer abc.def.ghi")), /Bearer \*\*\*/)
})
