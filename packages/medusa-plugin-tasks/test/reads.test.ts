/**
 * READS NEVER WRITE. Every GET route of the plugin, for the team and for a
 * sandbox account whose board is not seeded yet (or is stale): nothing in
 * any table changes and no event goes out. The sandbox is seeded only by
 * POST /admin/tasks/sandbox/ensure (the Tasks page) and the job.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import * as statusRoute from "../src/api/admin/tasks/route.ts"
import * as tasksRoute from "../src/api/admin/tasks/tasks/route.ts"
import * as taskRoute from "../src/api/admin/tasks/tasks/[id]/route.ts"
import * as commentsRoute from "../src/api/admin/tasks/tasks/[id]/comments/route.ts"
import * as activityRoute from "../src/api/admin/tasks/tasks/[id]/activity/route.ts"
import * as boardActivityRoute from "../src/api/admin/tasks/activity/route.ts"
import * as ordersRoute from "../src/api/admin/tasks/orders/[id]/route.ts"
import * as productsRoute from "../src/api/admin/tasks/products/[id]/route.ts"
import * as customersRoute from "../src/api/admin/tasks/customers/[id]/route.ts"
import { SANDBOX_KEY } from "../src/modules/tasks/lib/constants.ts"
import { contextOf } from "../src/workflows/tasks/context.ts"
import { addComment, createTask, deleteComment, deleteTask, editComment } from "../src/workflows/tasks/tasks.ts"
import { taskActivity } from "../src/workflows/tasks/read.ts"
import { setup, type Setup } from "./helpers.ts"

type Handler = (req: never, res: never) => Promise<void>

async function call(s: Setup, handler: Handler, actor: Record<string, string>, args: { params?: Record<string, string>; query?: Record<string, string> } = {}) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v
      return this
    },
    end() {
      return this
    },
  }
  await handler({ scope: s.container, auth_context: actor, params: args.params ?? {}, query: args.query ?? {}, headers: {}, body: {} } as never, res as never)
  return res
}

function state(s: Setup): string {
  return JSON.stringify([s.memory.tasks, s.memory.comments, s.memory.activity, s.memory.links, s.memory.settings].map((m) => [...m.entries()]))
}

test("reads: no GET route writes, seeds, cleans or emits, for the team or for a sandbox account", async () => {
  const s = setup()
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  const t = await createTask(s.container, team, { title: "Team task", links: [{ type: "order", id: "order_1" }], due_date: "2026-01-01" })
  await addComment(s.container, team, t.id, { body: "Note" })
  /* A stale sandbox marker: the old code reseeded on any read. */
  s.memory.settings.set(SANDBOX_KEY, { id: "tset_x", key: SANDBOX_KEY, value: { version: "0.0.0", seeded_at: "2020-01-01T00:00:00.000Z" }, updated_by: null, created_at: new Date(), updated_at: new Date(), deleted_at: null })
  const before = state(s)
  const events = s.events.length
  const gets: Array<[string, Handler, { params?: Record<string, string>; query?: Record<string, string> }]> = [
    ["status", statusRoute.GET as Handler, {}],
    ["board", tasksRoute.GET as Handler, { query: { view: "board" } }],
    ["list", tasksRoute.GET as Handler, { query: { q: "Team" } }],
    ["task", taskRoute.GET as Handler, { params: { id: t.id } }],
    ["comments", commentsRoute.GET as Handler, { params: { id: t.id } }],
    ["task activity", activityRoute.GET as Handler, { params: { id: t.id } }],
    ["board activity", boardActivityRoute.GET as Handler, {}],
    ["order widget", ordersRoute.GET as Handler, { params: { id: "order_1" } }],
    ["product widget", productsRoute.GET as Handler, { params: { id: "prod_1" } }],
    ["customer widget", customersRoute.GET as Handler, { params: { id: "cus_1" } }],
  ]
  for (const actor of [{ actor_id: "user_team", actor_type: "user" }, { actor_id: "user_demo", actor_type: "user" }, { actor_id: "apk_demo", actor_type: "api-key" }]) {
    for (const [name, handler, args] of gets) {
      const r = await call(s, handler, actor, args)
      assert.ok(r.statusCode < 500, `${name} as ${actor.actor_id}: ${r.statusCode}`)
    }
  }
  assert.equal(state(s), before, "every table exactly as it was")
  assert.equal(s.events.length, events, "no event")
})

test("log: deleting a task keeps its history; editing or deleting a comment logs the earlier text", async () => {
  const s = setup()
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  const t = await createTask(s.container, team, { title: "Logged" })
  const c = await addComment(s.container, team, t.id, { body: "First words" })
  await editComment(s.container, team, c.id, { body: "Second words" })
  await editComment(s.container, team, c.id, { body: "Second words" })
  const edits = (await taskActivity(s.container, team, t.id)).activity.filter((a) => a.type === "comment_edited")
  assert.equal(edits.length, 1, "an edit that changes nothing logs nothing")
  assert.equal(edits[0].metadata?.previous_body, "First words")
  await deleteComment(s.container, team, c.id)
  const deleted = (await taskActivity(s.container, team, t.id)).activity.find((a) => a.type === "comment_deleted")
  assert.equal(deleted?.metadata?.body, "Second words")
  await deleteTask(s.container, team, t.id)
  const kept = [...s.memory.activity.values()].filter((a) => a.task_id === t.id)
  assert.ok(kept.length >= 5)
  assert.ok(kept.every((a) => !a.deleted_at), "the log only grows")
})
