/**
 * THE SQL AGAINST A REAL POSTGRES, as one scenario any runner can drive (not
 * a test itself: the runner picks up `*.test.ts` only). `postgres.test.ts`
 * runs it on a scratch database when `TASKS_TEST_PG_URL` is set.
 *
 *   1. the KODA Panel tables as its migrations left them (two copies of the
 *      module), with made-up rows: the migration runs twice, copies every
 *      row once, with the same ids, dates and soft deletes, and never
 *      changes the old tables;
 *   2. a fresh database: the tables only;
 *   3. every statement of the stores, and the sandbox: a store of one board
 *      never reads or writes a row of the other.
 */
import assert from "node:assert/strict"
import { Migration20261007140000 } from "../src/modules/tasks/migrations/Migration20261007140000.ts"
import { createBoardStore, createSandboxStore, createSettingStore, rowsOf, type SqlRunner } from "../src/modules/tasks/lib/store.ts"
import { buildSandboxSeed } from "../src/modules/tasks/lib/sandbox.ts"
import type { TaskInsert } from "../src/modules/tasks/lib/rows.ts"
import * as statusRoute from "../src/api/admin/tasks/route.ts"
import * as tasksRoute from "../src/api/admin/tasks/tasks/route.ts"
import * as taskRoute from "../src/api/admin/tasks/tasks/[id]/route.ts"
import * as moveRoute from "../src/api/admin/tasks/tasks/[id]/move/route.ts"
import * as commentsRoute from "../src/api/admin/tasks/tasks/[id]/comments/route.ts"
import * as linksRoute from "../src/api/admin/tasks/tasks/[id]/links/route.ts"
import * as linkRoute from "../src/api/admin/tasks/tasks/[id]/links/[link_id]/route.ts"
import * as commentRoute from "../src/api/admin/tasks/comments/[id]/route.ts"
import * as ordersRoute from "../src/api/admin/tasks/orders/[id]/route.ts"
import * as resetRoute from "../src/api/admin/tasks/sandbox/reset/route.ts"
import { setup } from "./helpers.ts"

/** The demo copy of the KODA Panel module (its Migration20260623120000_initial), and the client copy's differences. */
const LEGACY_DEMO = [
  `CREATE TABLE IF NOT EXISTS "task" ("id" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo' CHECK ("status" IN ('backlog', 'todo', 'in_progress', 'rejected', 'review', 'done')),
    "priority" TEXT NOT NULL DEFAULT 'medium' CHECK ("priority" IN ('low', 'medium', 'high', 'urgent')),
    "assignee" TEXT NULL, "due_date" TIMESTAMPTZ NULL, "tags" JSONB NULL, "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "deleted_at" TIMESTAMPTZ NULL,
    CONSTRAINT "task_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "task_comment" ("id" TEXT NOT NULL, "body" TEXT NOT NULL, "author" TEXT NULL,
    "author_role" TEXT NOT NULL DEFAULT 'agency' CHECK ("author_role" IN ('agency', 'client', 'claude', 'koda')), "task_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "deleted_at" TIMESTAMPTZ NULL,
    CONSTRAINT "task_comment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FK_task_comment_task" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON UPDATE CASCADE ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS "activity_log" ("id" TEXT NOT NULL, "type" TEXT NOT NULL, "message" TEXT NULL, "actor" TEXT NULL, "metadata" JSONB NULL,
    "task_id" TEXT NOT NULL, "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "deleted_at" TIMESTAMPTZ NULL,
    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FK_activity_log_task" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON UPDATE CASCADE ON DELETE CASCADE)`,
]

/** Made-up rows: ULID-like ids without a prefix, as the module's `model.id()` wrote them. */
const LEGACY_ROWS = [
  `INSERT INTO "task" ("id", "title", "description", "status", "priority", "assignee", "due_date", "tags", "position", "created_at", "updated_at", "deleted_at") VALUES
    ('01AAAAAAAAAAAAAAAAAAAAAAA1', 'Sample roadmap item', 'Line one', 'in_progress', 'high', 'Sample Person', '2026-10-31T12:00:00Z', '["backend"]', 0, '2026-06-23T10:00:00.123456Z', '2026-10-01T10:00:00Z', NULL),
    ('01AAAAAAAAAAAAAAAAAAAAAAA2', 'Finished item', NULL, 'done', 'medium', NULL, NULL, NULL, 0, '2026-06-24T10:00:00Z', '2026-09-30T08:00:00Z', NULL),
    ('01AAAAAAAAAAAAAAAAAAAAAAA3', 'Deleted item', NULL, 'todo', 'low', 'AI helper', NULL, '[]', 1, '2026-06-25T10:00:00Z', '2026-06-26T10:00:00Z', '2026-07-01T00:00:00Z')`,
  `INSERT INTO "task_comment" ("id", "body", "author", "author_role", "task_id", "created_at") VALUES
    ('01CCCCCCCCCCCCCCCCCCCCCCC1', 'A comment', 'Sample Person', 'agency', '01AAAAAAAAAAAAAAAAAAAAAAA1', '2026-07-01T10:00:00Z'),
    ('01CCCCCCCCCCCCCCCCCCCCCCC2', 'An agent comment', 'AI helper', 'koda', '01AAAAAAAAAAAAAAAAAAAAAAA1', '2026-07-02T10:00:00Z'),
    ('01CCCCCCCCCCCCCCCCCCCCCCC3', 'On a deleted task', NULL, 'client', '01AAAAAAAAAAAAAAAAAAAAAAA3', '2026-06-25T11:00:00Z')`,
  `INSERT INTO "activity_log" ("id", "type", "message", "actor", "metadata", "task_id", "created_at") VALUES
    ('01DDDDDDDDDDDDDDDDDDDDDDD1', 'task_created', 'Utworzono zadanie', 'Sample Person', NULL, '01AAAAAAAAAAAAAAAAAAAAAAA1', '2026-06-23T10:00:00Z'),
    ('01DDDDDDDDDDDDDDDDDDDDDDD2', 'status_changed', 'todo -> done', 'Sample Person', '{"from": "todo", "to": "done"}', '01AAAAAAAAAAAAAAAAAAAAAAA2', '2026-09-30T08:00:00Z')`,
]

/** The client copy: `category` instead of `tags`, no activity metadata, author not null. */
const LEGACY_CLIENT = [
  `create table if not exists "task" ("id" text not null, "title" text not null, "description" text null, "status" text not null default 'backlog', "priority" text not null default 'medium', "category" text null, "assignee" text null, "due_date" timestamptz null, "position" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_pkey" primary key ("id"))`,
  `create table if not exists "activity_log" ("id" text not null, "type" text not null, "message" text not null, "actor" text not null default 'KODA', "task_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "activity_log_pkey" primary key ("id"))`,
  `create table if not exists "task_comment" ("id" text not null, "body" text not null, "author" text not null default 'KODA', "author_role" text not null default 'agency', "task_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_comment_pkey" primary key ("id"))`,
  `insert into "task" ("id", "title", "status", "category", "position") values ('01BBBBBBBBBBBBBBBBBBBBBBB1', 'Client item', 'review', 'frontend', 3)`,
  `insert into "activity_log" ("id", "type", "message", "task_id") values ('01EEEEEEEEEEEEEEEEEEEEEEE1', 'commented', 'Nowy komentarz', '01BBBBBBBBBBBBBBBBBBBBBBB1')`,
]

export interface Database {
  sql: SqlRunner
  /** Drops and creates the scratch schema the runner works in (empty). */
  reset(): Promise<void>
}

async function run(db: SqlRunner, statements: readonly string[]): Promise<void> {
  for (const s of statements) await db.raw(s)
}

/** The migration as Medusa runs it: `execute` reads the catalog, the collected statements run in one transaction. */
async function migrate(db: SqlRunner): Promise<void> {
  const statements: string[] = []
  const m = Object.create(Migration20261007140000.prototype) as { addSql(s: string): void; up(): Promise<void>; execute(sql: string): Promise<unknown> }
  m.addSql = (s) => statements.push(s)
  m.execute = async (sql) => rowsOf(await db.raw(sql))
  await m.up()
  const tx = db.transaction ? db.transaction.bind(db) : async <T>(fn: (t: SqlRunner) => Promise<T>) => fn(db)
  await tx(async (t) => run(t, statements))
}

const count = async (db: SqlRunner, sql: string): Promise<number> => Number(rowsOf<{ n: number | string }>(await db.raw(sql))[0]?.n ?? -1)

export async function pgScenario(db: Database): Promise<string[]> {
  const done: string[] = []
  const sql = db.sql

  /* 1. Adoption of the demo copy, twice. */
  await db.reset()
  await run(sql, [...LEGACY_DEMO, ...LEGACY_ROWS])
  const legacyBefore = JSON.stringify(rowsOf(await sql.raw(`select * from "task" order by "id"`)))
  await migrate(sql)
  await migrate(sql)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_task"`), 3)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_comment"`), 3)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_activity"`), 2)
  const [first] = rowsOf<Record<string, any>>(await sql.raw(`select * from "tasks_task" where "id" = '01AAAAAAAAAAAAAAAAAAAAAAA1'`))
  assert.equal(first.board, "main")
  assert.equal(first.title, "Sample roadmap item")
  assert.deepEqual(first.tags, ["backend"])
  assert.equal(new Date(first.created_at).toISOString(), "2026-06-23T10:00:00.123Z", "timestamps kept")
  assert.equal(first.metadata.adopted_from, "koda-panel")
  const [deleted] = rowsOf<Record<string, any>>(await sql.raw(`select * from "tasks_task" where "id" = '01AAAAAAAAAAAAAAAAAAAAAAA3'`))
  assert.ok(deleted.deleted_at, "soft deletes kept")
  assert.equal(deleted.tags, null, "an empty list of tags is no tags")
  const [finished] = rowsOf<Record<string, any>>(await sql.raw(`select * from "tasks_task" where "id" = '01AAAAAAAAAAAAAAAAAAAAAAA2'`))
  assert.equal(new Date(finished.completed_at).toISOString(), "2026-09-30T08:00:00.000Z", "done tasks completed when they last changed")
  const roles = rowsOf<{ id: string; author_role: string }>(await sql.raw(`select "id", "author_role" from "tasks_comment" order by "id"`)).map((r) => r.author_role)
  assert.deepEqual(roles, ["agency", "claude", "client"], "koda reads as claude")
  const [moved] = rowsOf<Record<string, any>>(await sql.raw(`select * from "tasks_activity" where "id" = '01DDDDDDDDDDDDDDDDDDDDDDD2'`))
  assert.deepEqual(moved.metadata, { from: "todo", to: "done", adopted_from: "koda-panel" })
  const [marker] = rowsOf<{ value: Record<string, any> }>(await sql.raw(`select "value" from "tasks_setting" where "key" = 'legacy:adoption'`))
  assert.deepEqual(
    [marker.value.state, marker.value.tasks, marker.value.comments, marker.value.activity, marker.value.source_tasks, marker.value.source_comments, marker.value.source_activity],
    ["adopted", 3, 3, 2, 3, 3, 2],
  )
  assert.equal(JSON.stringify(rowsOf(await sql.raw(`select * from "task" order by "id"`))), legacyBefore, "the old table is untouched")
  done.push("adoption of the demo copy, twice, rows and marker")

  /* 2. The client copy: a category becomes a tag. */
  await db.reset()
  await run(sql, LEGACY_CLIENT)
  await migrate(sql)
  const [client] = rowsOf<Record<string, any>>(await sql.raw(`select * from "tasks_task"`))
  assert.deepEqual([client.tags, client.position, client.status], [["frontend"], 3, "review"])
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_activity"`), 1)
  done.push("adoption of the client copy")

  /* 3. Another module's table called task: nothing copied, the marker says why. */
  await db.reset()
  await run(sql, [`create table "task" ("id" text primary key, "name" text)`, `insert into "task" values ('x', 'not ours')`])
  await migrate(sql)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_task"`), 0)
  const [skipped] = rowsOf<{ value: Record<string, any> }>(await sql.raw(`select "value" from "tasks_setting" where "key" = 'legacy:adoption'`))
  assert.equal(skipped.value.state, "skipped")
  done.push("a foreign task table is left alone")

  /* 4. A fresh database, then the stores on it. */
  await db.reset()
  await migrate(sql)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_setting"`), 0)
  const main = createBoardStore(sql, "main")
  const sandbox = createBoardStore(sql, "sandbox")
  const now = new Date("2026-10-07T12:00:00Z")
  const insert = (id: string, status: string, over: Partial<TaskInsert> = {}): TaskInsert => ({
    id,
    title: id,
    description: null,
    status,
    priority: "medium",
    assignee: null,
    assignee_id: null,
    due_date: null,
    tags: null,
    completed_at: null,
    created_by: "Tester",
    created_by_id: null,
    metadata: null,
    created_at: new Date(now.getTime() + Number(id.replace(/\D/g, "") || 0)),
    ...over,
  })
  const a = await main.insertTask(insert("task_1", "todo"), [{ id: "tlnk_1", task_id: "task_1", entity_type: "order", entity_id: "order_1", created_by: null, created_by_id: null, created_at: now }], [
    { id: "tact_1", task_id: "task_1", type: "task_created", message: "Created", actor: "Tester", actor_id: null, actor_type: "api-key", metadata: { status: "todo" }, created_at: now },
  ])
  const b = await main.insertTask(insert("task_2", "todo", { tags: ["x"], due_date: new Date("2026-10-01T12:00:00Z"), priority: "urgent" }), [], [])
  await main.insertTask(insert("task_3", "todo"), [], [])
  assert.deepEqual([a.task.position, b.task.position], [0, 1], "appended")
  assert.equal(a.links.length, 1)
  const moved2 = await main.moveTask("task_3", { status: "todo", beforeId: "task_1", afterId: null }, () => ({ patch: {}, activity: [] }), now)
  assert.equal(moved2?.after.position, 0)
  const order = rowsOf<{ id: string; position: number }>(await sql.raw(`select "id", "position" from "tasks_task" where "status" = 'todo' order by "position"`))
  assert.deepEqual(order, [{ id: "task_3", position: 0 }, { id: "task_1", position: 1 }, { id: "task_2", position: 2 }])
  const upd = await main.updateTask("task_1", () => ({ patch: { status: "done", completed_at: now }, activity: [] }), now)
  assert.equal(upd?.after.status, "done")
  assert.equal(upd?.after.position, 0)
  const left = rowsOf<{ id: string; position: number }>(await sql.raw(`select "id", "position" from "tasks_task" where "status" = 'todo' order by "position"`))
  assert.deepEqual(left, [{ id: "task_3", position: 0 }, { id: "task_2", position: 1 }], "the old column numbered again")
  const counts = await main.statusCounts(new Date("2026-10-07T00:00:00Z"))
  const todo = counts.find((c) => c.status === "todo")
  assert.deepEqual([todo?.count, todo?.overdue, todo?.urgent, todo?.unassigned], [2, 1, 1, 2])
  assert.equal((await main.listTasks({ tag: "x", limit: 10, offset: 0 })).count, 1)
  assert.equal((await main.listTasks({ like: "%task\\_2%", limit: 10, offset: 0 })).count, 1)
  assert.equal((await main.listTasks({ link: { type: "order", id: "order_1" }, limit: 10, offset: 0 })).count, 1)
  done.push("insert, move, status change, counts, filters")

  /* Comments and links only for a task of the board. */
  const comment = await main.insertComment({ id: "tcom_1", task_id: "task_2", body: "Hi", author: "Tester", author_role: "claude", author_id: "apk_1", author_type: "api-key", metadata: null, created_at: now }, [])
  assert.ok(comment)
  assert.equal(await sandbox.insertComment({ id: "tcom_2", task_id: "task_2", body: "Sneaky", author: null, author_role: "client", author_id: null, author_type: "user", metadata: null, created_at: now }, []), null)
  assert.equal(await sandbox.getTask("task_2"), null)
  assert.equal(await sandbox.getComment("tcom_1"), null)
  assert.equal(await sandbox.updateComment("tcom_1", "changed", now), null)
  assert.equal(await sandbox.deleteTask("task_2", [], now), null)
  assert.equal(await sandbox.insertLink({ id: "tlnk_x", task_id: "task_2", entity_type: "order", entity_id: "order_9", created_by: null, created_by_id: null, created_at: now }, []), null)
  assert.equal(await sandbox.deleteLink("task_1", "tlnk_1", [], now), null)
  assert.equal((await sandbox.listTasks({ limit: 100, offset: 0 })).count, 0)
  assert.equal((await sandbox.tasksForEntity("order", "order_1", 10)).count, 0)
  assert.equal(await sandbox.updateTask("task_2", () => ({ patch: { title: "x" }, activity: [] }), now), null)
  assert.equal(await sandbox.moveTask("task_2", { status: "done", beforeId: null, afterId: null }, () => ({ patch: {}, activity: [] }), now), null)
  done.push("the sandbox store cannot reach the main board")

  const again = await main.insertLink({ id: "tlnk_2", task_id: "task_1", entity_type: "order", entity_id: "order_1", created_by: null, created_by_id: null, created_at: now }, [])
  assert.deepEqual([again?.created, again?.link.id], [false, "tlnk_1"], "one link per task and record")
  assert.equal((await main.tasksForEntity("order", "order_1", 10)).count, 1)
  assert.equal((await main.commentCounts(["task_2"])).get("task_2"), 1)
  const gone = await main.deleteTask("task_2", [{ id: "tact_9", task_id: "task_2", type: "task_deleted", message: "Deleted", actor: null, actor_id: null, actor_type: "user", metadata: { title: "task_2" }, created_at: now }], now)
  assert.ok(gone?.deleted_at)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_comment" where "deleted_at" is null`), 0, "comments go with their task")
  const feed = await main.boardActivity(10)
  assert.ok(feed.some((f) => f.type === "task_deleted" && f.task_title === "task_2"))
  assert.equal((await main.apiKeyActivity()).count, 1)
  done.push("links, comments, deletion and the feed")

  /* The sandbox: a seed replaces only the sandbox board. */
  const seed = buildSandboxSeed({ now, viewer: { id: "user_demo", name: "Demo" }, entities: { productId: "prod_1", orderId: "order_1", customerId: "cus_1" } })
  const sandboxStore = createSandboxStore(sql)
  await sandboxStore.replace(seed, { key: "sandbox:seed", id: "tset_seed", value: seed.marker }, now)
  await sandboxStore.replace(seed, { key: "sandbox:seed", id: "tset_seed2", value: seed.marker }, now)
  assert.equal(await sandboxStore.countTasks(), 9)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_task" where "board" = 'main'`), 3, "the main board is untouched")
  assert.equal((await sandbox.tasksForEntity("order", "order_1", 10)).count, 1)
  assert.equal((await main.tasksForEntity("order", "order_1", 10)).count, 1, "the main board's link to the same order is its own")
  const settings = createSettingStore(sql, (p) => `${p}_x`)
  assert.equal(((await settings.get("sandbox:seed"))?.value as { tasks: number }).tasks, 9)
  await settings.put("sandbox:seed", { tasks: 1 }, "Tester", now)
  assert.equal(((await settings.get("sandbox:seed"))?.value as { tasks: number }).tasks, 1, "one row per key")
  done.push("sandbox seed, twice, and settings")

  /* Every read of both stores, once, on the real engine. */
  for (const store of [main, sandbox]) {
    const board = await store.boardTasks(1000, 100)
    assert.ok(board.every((t) => t.board === store.board))
    const all = await store.listTasks({ statuses: ["backlog", "todo", "in_progress", "review", "done", "rejected"], priorities: ["low", "medium", "high", "urgent"], limit: 500, offset: 0 })
    assert.ok(all.rows.every((t) => t.board === store.board))
    await store.listTasks({ assigneeId: "user_demo", assignee: "Anna", unassigned: false, limit: 5, offset: 0 })
    await store.listTasks({ unassigned: true, limit: 5, offset: 0 })
    const one = board[0]
    if (one) {
      assert.equal((await store.getTask(one.id))?.id, one.id)
      await store.listComments(one.id)
      await store.listActivity(one.id, 50)
      await store.listLinks([one.id])
      await store.commentCounts(board.map((t) => t.id))
    }
    await store.boardActivity(20)
    await store.apiKeyActivity()
    await store.statusCounts(now)
  }
  const sampleComment = rowsOf<{ id: string }>(await sql.raw(`select "id" from "tasks_comment" where "board" = 'sandbox' limit 1`))[0]
  const edited = await sandbox.updateComment(sampleComment.id, "Edited sample", now)
  assert.equal(edited?.body, "Edited sample")
  assert.equal((edited?.metadata as Record<string, unknown> | null)?.sample, undefined, "an edit drops the sample text")
  assert.ok((await sandbox.deleteComment(sampleComment.id, now))?.deleted_at)
  const sampleLink = rowsOf<{ id: string; task_id: string }>(await sql.raw(`select "id", "task_id" from "tasks_link" where "board" = 'sandbox' limit 1`))[0]
  assert.ok(await sandbox.deleteLink(sampleLink.task_id, sampleLink.id, [], now))
  done.push("every read of both boards")

  /* 5. The admin routes end to end on the SQL stores: the team works, a sandbox account reaches nothing of it. */
  await routesEndToEnd(db)
  done.push("the admin routes end to end on the SQL stores, with the sandbox kept apart")
  return done
}

async function routesEndToEnd(db: Database): Promise<void> {
  const sql = db.sql
  await db.reset()
  await migrate(sql)
  const s = setup(undefined, { sql })
  const call = async (handler: unknown, actor: Record<string, string>, args: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown> } = {}) => {
    const res = {
      statusCode: 200,
      payload: undefined as any,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(b: unknown) {
        this.payload = b
        return this
      },
    }
    await (handler as (req: unknown, res: unknown) => Promise<void>)({ scope: s.container, auth_context: actor, params: args.params ?? {}, body: args.body ?? {}, query: args.query ?? {} }, res)
    return { status: res.statusCode, body: res.payload }
  }
  const TEAM = { actor_id: "user_team", actor_type: "user" }
  const DEMO = { actor_id: "user_demo", actor_type: "user" }
  const created = await call(tasksRoute.POST, TEAM, { body: { title: "Team task", priority: "high", links: [{ type: "order", id: "order_1" }], assignee_id: "user_dev", due_date: "2026-10-12" } })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const teamTask = created.body.task
  assert.deepEqual([teamTask.links[0].label, teamTask.assignee, teamTask.position], ["#1042", "Dan Dev", 0])
  const second = await call(tasksRoute.POST, TEAM, { body: { title: "Second team task" } })
  const comment = await call(commentsRoute.POST, { actor_id: "apk_team", actor_type: "api-key" }, { params: { id: teamTask.id }, body: { body: "From the agent", author: "Claude Code" } })
  assert.deepEqual([comment.status, comment.body.comment.author, comment.body.comment.author_role], [201, "Claude Code", "claude"])
  const movedTeam = await call(moveRoute.POST, TEAM, { params: { id: second.body.task.id }, body: { status: "todo", before_id: teamTask.id } })
  assert.equal(movedTeam.body.task.position, 0)
  const updatedTeam = await call(taskRoute.POST, TEAM, { params: { id: teamTask.id }, body: { status: "review", tags: "release" } })
  assert.deepEqual([updatedTeam.status, updatedTeam.body.task.status, updatedTeam.body.task.tags], [200, "review", ["release"]])
  const detail = await call(taskRoute.GET, TEAM, { params: { id: teamTask.id } })
  assert.equal(detail.body.task.comments.length, 1)
  assert.ok(detail.body.task.activity.some((a: { type: string }) => a.type === "status_changed"))

  const status = await call(statusRoute.GET, DEMO)
  assert.deepEqual([status.status, status.body.board, status.body.counts.all], [200, "sandbox", 9])
  const mainBefore = JSON.stringify(rowsOf(await sql.raw(`select * from "tasks_task" where "board" = 'main' order by "id"`)))
  for (const [handler, args] of [
    [taskRoute.GET, { params: { id: teamTask.id } }],
    [taskRoute.POST, { params: { id: teamTask.id }, body: { title: "Hacked" } }],
    [taskRoute.DELETE, { params: { id: teamTask.id } }],
    [moveRoute.POST, { params: { id: teamTask.id }, body: { status: "rejected" } }],
    [commentsRoute.GET, { params: { id: teamTask.id } }],
    [commentsRoute.POST, { params: { id: teamTask.id }, body: { body: "Hello" } }],
    [commentRoute.POST, { params: { id: comment.body.comment.id }, body: { body: "Edited" } }],
    [commentRoute.DELETE, { params: { id: comment.body.comment.id } }],
    [linksRoute.POST, { params: { id: teamTask.id }, body: { type: "product", id: "prod_1" } }],
    [linkRoute.DELETE, { params: { id: teamTask.id, link_id: teamTask.links[0].id } }],
  ] as const) {
    const r = await call(handler, DEMO, args as never)
    assert.equal(r.status, 404, JSON.stringify(r.body))
  }
  const widget = await call(ordersRoute.GET, DEMO, { params: { id: "order_1" } })
  assert.ok(widget.body.tasks.every((t: { board: string }) => t.board === "sandbox"))
  const demoTask = await call(tasksRoute.POST, DEMO, { body: { title: "Demo task", board: "main" } })
  assert.equal(demoTask.body.task.board, "sandbox")
  assert.equal(JSON.stringify(rowsOf(await sql.raw(`select * from "tasks_task" where "board" = 'main' order by "id"`))), mainBefore, "the main board is exactly as it was")
  const reset = await call(resetRoute.POST, DEMO)
  assert.equal(reset.status, 200)
  assert.equal(await count(sql, `select count(*)::int as n from "tasks_task" where "board" = 'sandbox'`), 9)
  const deletedTeam = await call(taskRoute.DELETE, TEAM, { params: { id: second.body.task.id } })
  assert.equal(deletedTeam.status, 200)
  assert.ok(s.events.some((e) => e.name === "tasks.task.deleted" && e.data.board === "main"))
}
