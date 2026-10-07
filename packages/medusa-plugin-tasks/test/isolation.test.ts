/**
 * THE SANDBOX NEVER SEES THE MAIN BOARD. Every admin route of the plugin,
 * called as a sandbox account (and as a key that account created) with ids
 * of the main board: nothing is read, nothing changes, every id is "not
 * found". Then the same the other way round, and the request context on its
 * own (who is asking, failing closed).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import * as statusRoute from "../src/api/admin/tasks/route.ts"
import * as tasksRoute from "../src/api/admin/tasks/tasks/route.ts"
import * as taskRoute from "../src/api/admin/tasks/tasks/[id]/route.ts"
import * as moveRoute from "../src/api/admin/tasks/tasks/[id]/move/route.ts"
import * as commentsRoute from "../src/api/admin/tasks/tasks/[id]/comments/route.ts"
import * as activityRoute from "../src/api/admin/tasks/tasks/[id]/activity/route.ts"
import * as linksRoute from "../src/api/admin/tasks/tasks/[id]/links/route.ts"
import * as linkRoute from "../src/api/admin/tasks/tasks/[id]/links/[link_id]/route.ts"
import * as commentRoute from "../src/api/admin/tasks/comments/[id]/route.ts"
import * as boardActivityRoute from "../src/api/admin/tasks/activity/route.ts"
import * as ordersRoute from "../src/api/admin/tasks/orders/[id]/route.ts"
import * as productsRoute from "../src/api/admin/tasks/products/[id]/route.ts"
import * as customersRoute from "../src/api/admin/tasks/customers/[id]/route.ts"
import * as resetRoute from "../src/api/admin/tasks/sandbox/reset/route.ts"
import { contextOf } from "../src/workflows/tasks/context.ts"
import { ActionError } from "../src/workflows/tasks/runtime.ts"
import { setup, type Setup } from "./helpers.ts"

type Handler = (req: never, res: never) => Promise<void>
type Actor = { actor_id: string; actor_type: string }

const TEAM: Actor = { actor_id: "user_team", actor_type: "user" }
const DEMO: Actor = { actor_id: "user_demo", actor_type: "user" }
const DEMO_KEY: Actor = { actor_id: "apk_demo", actor_type: "api-key" }

interface Answer {
  status: number
  body: any
}

async function call(s: Setup, handler: Handler, actor: Actor, args: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown> } = {}): Promise<Answer> {
  const res = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(b: unknown) {
      this.payload = b
      return this
    },
  }
  const req = { scope: s.container, auth_context: actor, params: args.params ?? {}, body: args.body ?? {}, query: args.query ?? {} }
  await handler(req as never, res as never)
  return { status: res.statusCode, body: res.payload }
}

/** The team's board: a task with a comment and links, and a second one. */
async function mainBoard(s: Setup) {
  const created = await call(s, tasksRoute.POST as Handler, TEAM, {
    body: { title: "Real roadmap item", links: [{ type: "order", id: "order_1" }, { type: "product", id: "prod_1" }, { type: "customer", id: "cus_1" }] },
  })
  assert.equal(created.status, 201)
  const task = created.body.task
  const comment = await call(s, commentsRoute.POST as Handler, TEAM, { params: { id: task.id }, body: { body: "Internal note" } })
  assert.equal(comment.status, 201)
  const other = await call(s, tasksRoute.POST as Handler, TEAM, { body: { title: "Second real item", status: "review" } })
  return { task, linkId: task.links[0].id as string, commentId: comment.body.comment.id as string, otherId: other.body.task.id as string }
}

function snapshot(s: Setup, board: string): string {
  const rows = [s.memory.tasks, s.memory.comments, s.memory.links, s.memory.activity].map((m) => [...m.values()].filter((r) => r.board === board))
  return JSON.stringify(rows)
}

for (const [who, actor] of [
  ["a sandbox account", DEMO],
  ["a key created by a sandbox account", DEMO_KEY],
] as const) {
  test(`isolation: ${who} reads and changes nothing of the main board through any route`, async () => {
    const s = setup()
    const main = await mainBoard(s)
    /* The sandbox exists too: seeded on the first visit. */
    await call(s, statusRoute.GET as Handler, DEMO)
    const sandboxTask = [...s.memory.tasks.values()].find((t) => t.board === "sandbox")
    assert.ok(sandboxTask, "the sandbox was seeded")
    const before = snapshot(s, "main")
    s.memory.boardsAsked.length = 0

    const notFound: Array<[string, Handler, { params?: Record<string, string>; body?: unknown }]> = [
      ["GET task", taskRoute.GET as Handler, { params: { id: main.task.id } }],
      ["POST task", taskRoute.POST as Handler, { params: { id: main.task.id }, body: { title: "Hacked", status: "done" } }],
      ["DELETE task", taskRoute.DELETE as Handler, { params: { id: main.task.id } }],
      ["POST move", moveRoute.POST as Handler, { params: { id: main.task.id }, body: { status: "rejected" } }],
      ["POST move next to a main task", moveRoute.POST as Handler, { params: { id: sandboxTask.id }, body: { status: "todo", after_id: main.otherId } }],
      ["GET comments", commentsRoute.GET as Handler, { params: { id: main.task.id } }],
      ["POST comment", commentsRoute.POST as Handler, { params: { id: main.task.id }, body: { body: "Hello from the demo" } }],
      ["GET activity", activityRoute.GET as Handler, { params: { id: main.task.id } }],
      ["POST link", linksRoute.POST as Handler, { params: { id: main.task.id }, body: { type: "order", id: "order_1" } }],
      ["DELETE link", linkRoute.DELETE as Handler, { params: { id: main.task.id, link_id: main.linkId } }],
      ["DELETE main link through a sandbox task", linkRoute.DELETE as Handler, { params: { id: sandboxTask.id, link_id: main.linkId } }],
      ["POST comment edit", commentRoute.POST as Handler, { params: { id: main.commentId }, body: { body: "Edited by the demo" } }],
      ["DELETE comment", commentRoute.DELETE as Handler, { params: { id: main.commentId } }],
    ]
    for (const [name, handler, args] of notFound) {
      const r = await call(s, handler, actor, args)
      if (name === "POST move next to a main task") {
        assert.equal(r.status, 200, name)
        assert.equal(r.body.task.board, "sandbox", "a main neighbour is simply not in the sandbox column")
        continue
      }
      assert.equal(r.status, 404, `${name} answers 404, got ${r.status} ${JSON.stringify(r.body)}`)
      assert.equal(r.body.code, "not_found", name)
      assert.doesNotMatch(JSON.stringify(r.body), /Real roadmap item|Internal note/, `${name} leaks nothing`)
    }

    const reads: Array<[string, Handler, { params?: Record<string, string>; query?: Record<string, unknown> }]> = [
      ["board", tasksRoute.GET as Handler, { query: { view: "board" } }],
      ["list", tasksRoute.GET as Handler, { query: { q: "Real", limit: "500" } }],
      ["list by link", tasksRoute.GET as Handler, { query: { link_type: "order", link_id: "order_1" } }],
      ["activity", boardActivityRoute.GET as Handler, { query: { limit: "100" } }],
      ["order widget", ordersRoute.GET as Handler, { params: { id: "order_1" } }],
      ["product widget", productsRoute.GET as Handler, { params: { id: "prod_1" } }],
      ["customer widget", customersRoute.GET as Handler, { params: { id: "cus_1" } }],
      ["status", statusRoute.GET as Handler, {}],
    ]
    for (const [name, handler, args] of reads) {
      const r = await call(s, handler, actor, args)
      assert.equal(r.status, 200, name)
      const text = JSON.stringify(r.body)
      assert.doesNotMatch(text, /Real roadmap item|Second real item|Internal note/, `${name} shows nothing of the main board`)
      assert.ok(!text.includes(main.task.id) && !text.includes(main.otherId), `${name} has no main ids`)
    }
    const status = await call(s, statusRoute.GET as Handler, actor)
    assert.equal(status.body.board, "sandbox")
    assert.equal(status.body.counts.all, [...s.memory.tasks.values()].filter((t) => t.board === "sandbox" && !t.deleted_at).length)

    const created = await call(s, tasksRoute.POST as Handler, actor, { body: { title: "Demo task", board: "main" } })
    assert.equal(created.status, 201)
    assert.equal(created.body.task.board, "sandbox", "a body never chooses the board")
    const reset = await call(s, resetRoute.POST as Handler, actor)
    assert.equal(reset.status, 200)

    assert.equal(snapshot(s, "main"), before, "the main board is exactly as it was")
    assert.deepEqual([...new Set(s.memory.boardsAsked)], ["sandbox"], "no store of the main board was even opened")
    assert.ok(!s.events.some((e) => e.data.board === "main" && e.data.actor?.id === actor.actor_id), "no event about the main board")
  })
}

test("isolation: the team does not see the sandbox either, and the sandbox events say demo", async () => {
  const s = setup()
  await call(s, statusRoute.GET as Handler, DEMO)
  const demoTask = await call(s, tasksRoute.POST as Handler, DEMO, { body: { title: "Demo visitor's task" } })
  const id = demoTask.body.task.id
  const event = s.events.find((e) => e.name === "tasks.task.created" && e.data.id === id)
  assert.deepEqual([event?.data.board, event?.data.demo], ["sandbox", true])
  for (const [handler, args] of [
    [taskRoute.GET, { params: { id } }],
    [taskRoute.POST, { params: { id }, body: { title: "x" } }],
    [commentsRoute.POST, { params: { id }, body: { body: "x" } }],
    [moveRoute.POST, { params: { id }, body: { status: "done" } }],
  ] as const) {
    const r = await call(s, handler as Handler, TEAM, args)
    assert.equal(r.status, 404)
  }
  const board = await call(s, tasksRoute.GET as Handler, TEAM, { query: { view: "board" } })
  assert.equal(board.body.tasks.length, 0)
  assert.equal([...s.memory.tasks.values()].filter((t) => t.board === "main").length, 0, "the team's board got no sample tasks")
})

test("context: who asks decides the board; nothing in the request can", async () => {
  const s = setup()
  assert.equal((await contextOf(s.container, TEAM, { board: "sandbox" })).board, "main")
  assert.equal((await contextOf(s.container, DEMO, { board: "main" })).board, "sandbox")
  assert.equal((await contextOf(s.container, { actor_id: "user_demo2", actor_type: "user" })).board, "sandbox")
  assert.equal((await contextOf(s.container, { actor_id: "apk_team", actor_type: "api-key" })).board, "main")
  assert.equal((await contextOf(s.container, DEMO_KEY)).board, "sandbox", "a key inherits its creator's board")
  assert.equal((await contextOf(s.container, { actor_id: "apk_server", actor_type: "api-key" })).board, "main", "a key made by server code")
})

async function refusal(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p
  } catch (err) {
    if (err instanceof ActionError) return err
    throw err
  }
  assert.fail("expected a refusal")
}

test("context: no actor, an unknown account or another kind of actor is refused", async () => {
  const s = setup()
  for (const auth of [null, {}, { actor_id: "" }, { actor_id: "user_ghost", actor_type: "user" }, { actor_id: "apk_ghost", actor_type: "api-key" }, { actor_id: "cus_1", actor_type: "customer" }]) {
    const err = await refusal(contextOf(s.container, auth as never))
    assert.equal(err.status, 401, JSON.stringify(auth))
  }
})

test("context: fails closed while sandbox accounts exist; a key whose creator is gone cannot prove its board", async () => {
  const s = setup()
  s.failUsers.on = true
  const down = await refusal(contextOf(s.container, DEMO))
  assert.deepEqual([down.status, down.code], [503, "account_unavailable"])
  const keyDown = await refusal(contextOf(s.container, DEMO_KEY))
  assert.equal(keyDown.status, 503)
  s.failUsers.on = false
  const orphan = await refusal(contextOf(s.container, { actor_id: "apk_orphan", actor_type: "api-key" }))
  assert.deepEqual([orphan.status, orphan.code], [403, "key_owner_missing"])

  const open = setup({})
  open.failUsers.on = true
  const ctx = await contextOf(open.container, TEAM)
  assert.deepEqual([ctx.board, ctx.actor.name], ["main", null], "without sandbox accounts every board is main anyway")
  open.failUsers.on = false
  assert.equal((await contextOf(open.container, { actor_id: "apk_orphan", actor_type: "api-key" })).board, "main")
})

test("routes: refusals carry a status, a type and a stable code", async () => {
  const s = setup()
  const r = await call(s, tasksRoute.POST as Handler, TEAM, { body: { title: "" } })
  assert.equal(r.status, 400)
  assert.deepEqual([r.body.type, r.body.code], ["invalid_data", "invalid_data"])
  assert.equal(r.body.errors[0].field, "title")
  const anonymous = await call(s, tasksRoute.GET as Handler, { actor_id: "", actor_type: "user" })
  assert.deepEqual([anonymous.status, anonymous.body.type], [401, "unauthorized"])
  const off = await call(setup({}), resetRoute.POST as Handler, TEAM)
  assert.deepEqual([off.status, off.body.code], [409, "sandbox_off"])
})
