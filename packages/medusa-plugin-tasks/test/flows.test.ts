/**
 * The changes end to end: the real flows (create, update, move, delete,
 * comments, links, reads) against the in-memory stores of `helpers.ts`, a
 * fake Query, a fake user and API key module and a recording event bus.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { addComment, addLink, createTask, deleteComment, deleteTask, editComment, moveTask, removeLink, updateTask } from "../src/workflows/tasks/tasks.ts"
import { boardActivity, boardView, buildStatus, entityTasks, listTasks, taskDetail } from "../src/workflows/tasks/read.ts"
import { apiKeyProfile, contextOf, userProfile } from "../src/workflows/tasks/context.ts"
import { ActionError } from "../src/workflows/tasks/runtime.ts"
import { ensureSandbox } from "../src/workflows/tasks/sandbox.ts"
import { systemActor, type RequestContext } from "../src/modules/tasks/lib/actor.ts"
import { DEFAULT_OPTIONS, setup, type Setup } from "./helpers.ts"

async function refused(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p
  } catch (err) {
    if (err instanceof ActionError) return err
    throw err
  }
  assert.fail("expected a refusal")
}

const team = (s: Setup) => contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
const agency = (s: Setup) => contextOf(s.container, { actor_id: "user_dev", actor_type: "user" })
const key = (s: Setup, body?: unknown, id = "apk_team") => contextOf(s.container, { actor_id: id, actor_type: "api-key" }, body)

async function make(s: Setup, ctx: RequestContext, body: Record<string, unknown>) {
  return createTask(s.container, ctx, { title: "A task", ...body })
}

test("create: a task at the end of its column, with its activity, links named by Medusa and tasks.task.created", async () => {
  const s = setup()
  const ctx = await team(s)
  const first = await make(s, ctx, { title: "First" })
  const second = await make(s, ctx, {
    title: "Refund the damaged item",
    priority: "urgent",
    assignee_id: "user_dev",
    due_date: "2026-10-12",
    tags: ["support"],
    links: [{ type: "order", id: "order_1" }, { type: "customer", id: "cus_1" }],
  })
  assert.equal(first.position, 0)
  assert.equal(second.position, 1, "appended to the column")
  assert.equal(second.board, "main")
  assert.equal(second.assignee, "Dan Dev")
  assert.equal(second.assignee_id, "user_dev")
  assert.equal(second.due_date, "2026-10-12T12:00:00.000Z")
  assert.deepEqual(
    second.links.map((l) => [l.type, l.entity_id, l.label]),
    [
      ["order", "order_1", "#1042"],
      ["customer", "cus_1", "Anna Nowak"],
    ],
  )
  assert.equal(second.created_by, "Olga Owner")
  const detail = await taskDetail(s.container, ctx, second.id)
  assert.deepEqual(
    detail.activity.map((a) => a.type).sort(),
    ["assigned", "linked", "linked", "task_created"],
  )
  const e = s.events.find((x) => x.name === "tasks.task.created" && x.data.id === second.id)
  assert.ok(e)
  assert.deepEqual(e?.data.links, [
    { type: "order", id: "order_1" },
    { type: "customer", id: "cus_1" },
  ])
  assert.deepEqual(e?.data.actor, { type: "user", id: "user_team", name: "Olga Owner", role: "client" })
  assert.equal(e?.data.previous_status, null)
  assert.equal(e?.data.demo, false)
  assert.equal(e?.data.board, "main")
})

test("create: a done task is completed now; a record Medusa does not have is refused before anything is written", async () => {
  const s = setup()
  const ctx = await team(s)
  const done = await make(s, ctx, { status: "done" })
  assert.ok(done.completed_at)
  const before = s.memory.tasks.size
  const err = await refused(make(s, ctx, { links: [{ type: "order", id: "order_404" }] }))
  assert.deepEqual([err.status, err.code], [400, "link_not_found"])
  assert.equal(s.memory.tasks.size, before)
  const invalid = await refused(make(s, ctx, { title: "", priority: "huge" }))
  assert.equal(invalid.code, "invalid_data")
  assert.deepEqual(
    (invalid.extra.errors as Array<{ field: string }>).map((e) => e.field),
    ["title", "priority"],
  )
})

test("API keys: a script or AI agent writes as claude, under the name it sends, else the key's title", async () => {
  const s = setup()
  const signed = await key(s, { title: "x", author: "  Claude Code " })
  assert.deepEqual(signed.actor, { type: "api-key", id: "apk_team", name: "Claude Code", email: null, role: "claude" })
  const task = await createTask(s.container, signed, { title: "Report from the agent", author: "Claude Code" })
  assert.equal(task.created_by, "Claude Code")
  const comment = await addComment(s.container, signed, task.id, { body: "Deployed to staging.", author: "Claude Code" })
  assert.equal(comment.author, "Claude Code")
  assert.equal(comment.author_role, "claude")
  assert.equal(comment.author_type, "api-key")
  const unsigned = await key(s, {})
  assert.equal(unsigned.actor.name, "Deploy bot", "the key's title without a name in the body")
  const c2 = await addComment(s.container, unsigned, task.id, { body: "No name" })
  assert.equal(c2.author, "Deploy bot")
  const e = s.events.find((x) => x.name === "tasks.comment.created" && x.data.id === comment.id)
  assert.deepEqual(e?.data.actor, { type: "api-key", id: "apk_team", name: "Claude Code", role: "claude" })
  assert.equal(e?.data.author_role, "claude")
  assert.equal(e?.data.task_id, task.id)
  const people = await team(s)
  const human = await addComment(s.container, people, task.id, { body: "Thanks", author: "Pretending to be a bot" })
  assert.equal(human.author, "Olga Owner", "people signed in to the admin write under their own name")
  assert.equal(human.author_role, "client")
  const dev = await addComment(s.container, await agency(s), task.id, { body: "On it" })
  assert.equal(dev.author_role, "agency", "agencyAccounts by domain")
})

test("API keys: never under the name or e-mail of a person on the team; on the sandbox the name is dropped without telling who is on the team", async () => {
  const s = setup({ ...DEFAULT_OPTIONS, people: [{ name: "Anna Kowalska" }, { name: "Claude Code", kind: "agent" }] })
  for (const author of ["Olga Owner", "  OLGA   owner ", "owner@store.example", "Anna Kowalska", "anna kowalska"]) {
    const err = await refused(key(s, { author }))
    assert.deepEqual([err.status, err.code, (err.extra.errors as Array<{ field: string }>)[0].field], [400, "author_reserved", "author"], author)
  }
  assert.equal((await key(s, { author: "Claude Code" })).actor.name, "Claude Code", "an agent of the people option is fine")
  assert.equal((await key(s, { author: "Olga" })).actor.name, "Olga", "a first name alone is not a person's full name")
  /* The sandbox: the same name is simply not used, so the answer says nothing about the team. */
  const demo = await key(s, { author: "Olga Owner" }, "apk_demo")
  assert.equal(demo.board, "sandbox")
  assert.equal(demo.actor.name, "Demo key")
  /* Writing with a refused name changes nothing. */
  assert.equal(s.memory.tasks.size, 0)
  /* The user module is down: a sent name cannot be checked on the main board. */
  const down = setup()
  await apiKeyProfile(down.container, "apk_team")
  await userProfile(down.container, "user_team")
  down.failUsers.on = true
  const err = await refused(key(down, { author: "Claude Code" }))
  assert.deepEqual([err.status, err.message], [503, "The name in author could not be checked. Try again in a moment."])
})

test("workflows: automations without a user comment as claude unless the input names a role", async () => {
  const s = setup()
  const t = await createTask(s.container, { board: "main", sandbox: false, actor: systemActor("Order watcher") }, { title: "From a subscriber" })
  const c = await addComment(s.container, { board: "main", sandbox: false, actor: systemActor("Order watcher") }, t.id, { body: "Flagged" })
  assert.equal(c.author_role, "claude")
  const team = await addComment(s.container, { board: "main", sandbox: false, actor: systemActor("Store bot", "client") }, t.id, { body: "As the store" })
  assert.equal(team.author_role, "client")
})

test("assignees: an admin user of the board, by id or e-mail, or free text; never a sandbox account on the main board", async () => {
  const s = setup()
  const ctx = await team(s)
  const t = await make(s, ctx, {})
  const byEmail = await updateTask(s.container, ctx, t.id, { assignee_email: "DEV@agency.example" })
  assert.equal(byEmail.assignee_id, "user_dev")
  const text = await updateTask(s.container, ctx, t.id, { assignee: "frontend" })
  assert.deepEqual([text.assignee, text.assignee_id], ["frontend", null])
  const demo = await refused(updateTask(s.container, ctx, t.id, { assignee_id: "user_demo" }))
  assert.deepEqual([demo.status, demo.code, (demo.extra.errors as Array<{ code: string }>)[0].code], [400, "invalid_data", "other_board"])
  const ghost = await refused(updateTask(s.container, ctx, t.id, { assignee_id: "user_ghost" }))
  assert.equal((ghost.extra.errors as Array<{ code: string }>)[0].code, "not_found")
  /* A sandbox account learns nothing about the team's accounts: a team member answers like nobody. */
  const demoCtx = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  const mine = await make(s, demoCtx, {})
  for (const body of [{ assignee_id: "user_team" }, { assignee_email: "owner@store.example" }, { assignee_id: "user_ghost" }]) {
    const err = await refused(updateTask(s.container, demoCtx, mine.id, body))
    assert.equal((err.extra.errors as Array<{ code: string }>)[0].code, "not_found", JSON.stringify(body))
  }
  const none = await updateTask(s.container, ctx, t.id, { assignee_id: null })
  assert.deepEqual([none.assignee, none.assignee_id], [null, null])
  const detail = await taskDetail(s.container, ctx, t.id)
  assert.deepEqual(
    detail.activity
      .filter((a) => a.type === "assigned")
      .map((a) => String(a.metadata?.to))
      .sort(),
    ["Dan Dev", "frontend", "null"],
    "one entry per change, refusals log nothing",
  )
})

test("update: a status change completes the task, appends it to its new column and numbers the old one again", async () => {
  const s = setup()
  const ctx = await team(s)
  const [a, b, c] = [await make(s, ctx, { title: "a" }), await make(s, ctx, { title: "b" }), await make(s, ctx, { title: "c" })]
  await make(s, ctx, { title: "already done", status: "done" })
  s.events.length = 0
  const moved = await updateTask(s.container, ctx, a.id, { status: "done" })
  assert.equal(moved.status, "done")
  assert.ok(moved.completed_at)
  assert.equal(moved.position, 0, "closed columns are ordered by when tasks closed, not numbered")
  const todo = (await listTasks(s.container, ctx, { status: "todo" })).tasks
  assert.deepEqual(
    todo.map((x) => [x.id, x.position]),
    [
      [b.id, 0],
      [c.id, 1],
    ],
  )
  assert.deepEqual(
    s.events.map((e) => [e.name, e.data.previous_status, e.data.status]),
    [["tasks.task.status_changed", "todo", "done"]],
  )
  const reopened = await updateTask(s.container, ctx, a.id, { status: "todo" })
  assert.equal(reopened.completed_at, null)
})

test("update: other fields emit tasks.task.updated with what changed; nothing changed, nothing written", async () => {
  const s = setup()
  const ctx = await team(s)
  const t = await make(s, ctx, { title: "Old", priority: "low" })
  s.events.length = 0
  await updateTask(s.container, ctx, t.id, { title: "New", priority: "high", due_date: "2026-11-02", tags: "a, b", status: "review" })
  assert.deepEqual(
    s.events.map((e) => [e.name, e.data.changes]),
    [
      ["tasks.task.status_changed", []],
      ["tasks.task.updated", ["title", "priority", "due_date", "tags"]],
    ],
  )
  const activityBefore = s.memory.activity.size
  s.events.length = 0
  await updateTask(s.container, ctx, t.id, { title: "New", priority: "high", due_date: "2026-11-02T12:00:00Z", tags: ["a", "b"] })
  assert.equal(s.events.length, 0, "the same values are no change")
  assert.equal(s.memory.activity.size, activityBefore)
  const detail = await taskDetail(s.container, ctx, t.id)
  const updated = detail.activity.find((a) => a.type === "task_updated")
  assert.deepEqual(updated?.metadata?.priority, { from: "low", to: "high" })
  assert.deepEqual(updated?.metadata?.due_date, { from: null, to: "2026-11-02" })
})

test("move: drag within a column and across columns; only a status change is announced", async () => {
  const s = setup()
  const ctx = await team(s)
  const [a, b, c] = [await make(s, ctx, { title: "a" }), await make(s, ctx, { title: "b" }), await make(s, ctx, { title: "c" })]
  const r = await make(s, ctx, { title: "r", status: "review" })
  s.events.length = 0
  await moveTask(s.container, ctx, c.id, { status: "todo", before_id: a.id })
  assert.deepEqual(
    (await listTasks(s.container, ctx, { status: "todo" })).tasks.map((x) => x.title),
    ["c", "a", "b"],
  )
  assert.equal(s.events.length, 0, "a reorder emits nothing")
  const moved = await moveTask(s.container, ctx, a.id, { status: "review", after_id: r.id })
  assert.equal(moved.status, "review")
  assert.deepEqual(
    (await listTasks(s.container, ctx, { status: "review" })).tasks.map((x) => [x.title, x.position]),
    [
      ["r", 0],
      ["a", 1],
    ],
  )
  assert.deepEqual(
    (await listTasks(s.container, ctx, { status: "todo" })).tasks.map((x) => [x.title, x.position]),
    [
      ["c", 0],
      ["b", 1],
    ],
  )
  assert.deepEqual(
    s.events.map((e) => [e.name, e.data.previous_status, e.data.status]),
    [["tasks.task.status_changed", "todo", "review"]],
  )
  const done = await moveTask(s.container, ctx, b.id, { status: "done" })
  assert.ok(done.completed_at)
  const log = (await taskDetail(s.container, ctx, b.id)).activity
  assert.deepEqual(
    log.filter((a) => a.type === "status_changed").map((a) => a.metadata),
    [{ from: "todo", to: "done" }],
  )
})

test("delete: a soft delete with comments and links; the board's feed keeps the deletion, the task answers 404", async () => {
  const s = setup()
  const ctx = await team(s)
  const t = await make(s, ctx, { title: "Doomed", links: [{ type: "product", id: "prod_1" }] })
  await addComment(s.container, ctx, t.id, { body: "Bye" })
  const r = await deleteTask(s.container, ctx, t.id)
  assert.deepEqual(r, { id: t.id, object: "task", deleted: true })
  assert.ok(s.memory.tasks.get(t.id)?.deleted_at, "still in the table")
  assert.ok([...s.memory.comments.values()].every((c) => c.task_id !== t.id || c.deleted_at))
  assert.ok([...s.memory.links.values()].every((l) => l.task_id !== t.id || l.deleted_at))
  assert.equal((await refused(taskDetail(s.container, ctx, t.id))).status, 404)
  const feed = (await boardActivity(s.container, ctx)).activity
  assert.deepEqual([feed[0].type, feed[0].task_title], ["task_deleted", "Doomed"])
  const e = s.events.find((x) => x.name === "tasks.task.deleted")
  assert.deepEqual([e?.data.id, e?.data.links], [t.id, [{ type: "product", id: "prod_1" }]])
  assert.equal((await refused(deleteTask(s.container, ctx, t.id))).status, 404, "twice is not found")
})

test("comments: the author edits and deletes their own; nobody else's", async () => {
  const s = setup()
  const owner = await team(s)
  const dev = await agency(s)
  const t = await make(s, owner, {})
  const c = await addComment(s.container, owner, t.id, { body: "Mine" })
  assert.equal(c.own, true)
  const edited = await editComment(s.container, owner, c.id, { body: "Mine, edited" })
  assert.equal(edited.body, "Mine, edited")
  assert.ok(edited.edited_at)
  const other = await refused(editComment(s.container, dev, c.id, { body: "Hijack" }))
  assert.deepEqual([other.status, other.code], [403, "not_author"])
  assert.equal((await refused(deleteComment(s.container, await key(s), c.id))).code, "not_author", "a key is not the person who wrote it")
  assert.deepEqual(await deleteComment(s.container, owner, c.id), { id: c.id, object: "task_comment", deleted: true })
  assert.equal((await taskDetail(s.container, owner, t.id)).comments.length, 0)
  const empty = await refused(addComment(s.container, owner, t.id, { body: "  " }))
  assert.equal(empty.code, "invalid_data")
})

test("links: link once, link twice changes nothing, unknown records and the limit are refused, unlinking is announced", async () => {
  const s = setup()
  const ctx = await team(s)
  const t = await make(s, ctx, {})
  s.events.length = 0
  const first = await addLink(s.container, ctx, t.id, { type: "product", id: "prod_1" })
  assert.deepEqual([first.created, first.link.label, first.link.found], [true, "Linen shirt", true])
  const again = await addLink(s.container, ctx, t.id, { type: "product", id: "prod_1" })
  assert.equal(again.created, false)
  assert.equal(again.link.id, first.link.id)
  assert.deepEqual(
    s.events.map((e) => [e.name, e.data.changes]),
    [["tasks.task.updated", ["links"]]],
  )
  const missing = await refused(addLink(s.container, ctx, t.id, { type: "order", id: "order_404" }))
  assert.deepEqual([missing.status, missing.code], [404, "link_not_found"])
  const wrong = await refused(addLink(s.container, ctx, t.id, { type: "order", id: "prod_1" }))
  assert.equal(wrong.code, "invalid_data")
  for (let i = 0; i < 19; i += 1) s.memory.links.set(`tlnk_fill_${i}`, { id: `tlnk_fill_${i}`, board: "main", task_id: t.id, entity_type: "order", entity_id: `order_x${i}`, created_by: null, created_by_id: null, created_at: new Date(), updated_at: new Date(), deleted_at: null })
  assert.equal((await refused(addLink(s.container, ctx, t.id, { type: "customer", id: "cus_1" }))).code, "too_many_links")
  const removed = await removeLink(s.container, ctx, t.id, first.link.id)
  assert.equal(removed.deleted, true)
  assert.equal((await refused(removeLink(s.container, ctx, t.id, first.link.id))).status, 404)
  const widget = await entityTasks(s.container, ctx, "product", "prod_1")
  assert.equal(widget.count, 0)
})

test("widgets: tasks of one record, open ones first; an id of another type is not found", async () => {
  const s = setup()
  const ctx = await team(s)
  const open = await make(s, ctx, { title: "Open", links: [{ type: "order", id: "order_1" }] })
  await make(s, ctx, { title: "Closed", status: "done", links: [{ type: "order", id: "order_1" }] })
  await make(s, ctx, { title: "Elsewhere" })
  const w = await entityTasks(s.container, ctx, "order", "order_1")
  assert.deepEqual(w.tasks.map((t) => t.title), ["Open", "Closed"])
  assert.equal(w.count, 2)
  assert.equal(w.tasks[0].id, open.id)
  assert.equal((await refused(entityTasks(s.container, ctx, "order", "prod_1"))).status, 404)
})

test("board and status: counters of the board, the team's people without sandbox accounts, named people for the team only", async () => {
  const s = setup({
    sandboxAccounts: ["demo@store.example"],
    agencyAccounts: ["@agency.example"],
    people: [{ name: "Koda AI", kind: "agent", role: { en: "Code", pl: "Kod" } }],
  })
  const ctx = await team(s)
  await make(s, ctx, { title: "late", due_date: "2020-01-01", priority: "high" })
  await make(s, ctx, { title: "free", assignee: "Koda AI" })
  await make(s, ctx, { title: "done", status: "done" })
  const board = await boardView(s.container, ctx, { today: "2026-10-07" })
  assert.equal(board.tasks.length, 3)
  assert.deepEqual(
    [board.counts.all, board.counts.open, board.counts.overdue, board.counts.urgent, board.counts.unassigned, board.counts.done],
    [3, 2, 1, 1, 1, 1],
  )
  assert.equal(board.hidden_closed, 0)
  const status = await buildStatus(s.container, ctx, { today: "2026-10-07" })
  assert.deepEqual(status.people.map((p) => [p.id, p.role]), [
    ["user_team", "client"],
    ["user_dev", "agency"],
    ["user_demo2", "client"],
  ])
  assert.deepEqual(status.named_people, [{ name: "Koda AI", avatar: null, role: { en: "Code", pl: "Kod" }, kind: "agent" }])
  assert.deepEqual(status.options.sandbox_accounts, ["demo@store.example"])
  assert.equal(status.viewer.name, "Olga Owner")
  assert.equal(status.sandbox, false)
  const sandbox = await buildStatus(s.container, await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" }))
  assert.deepEqual(sandbox.named_people, [], "the team's names stay with the team")
  assert.equal(sandbox.options.sandbox_accounts, null)
  assert.equal(sandbox.options.agency_accounts, null)
  assert.equal(sandbox.adoption, null)
  assert.deepEqual(sandbox.people.map((p) => p.id), ["user_demo"])
})

test("board: a sample task's edited title drops only its own sample text", async () => {
  const s = setup()
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await ensureSandbox(s.container, demo)
  const board = await boardView(s.container, demo)
  const sample = board.tasks.find((t) => t.sample?.title && t.sample?.description)
  assert.ok(sample)
  const edited = await updateTask(s.container, demo, sample.id, { title: "My own title" })
  assert.equal(edited.sample?.title, undefined)
  assert.ok(edited.sample?.description?.pl, "the description keeps both languages")
})
