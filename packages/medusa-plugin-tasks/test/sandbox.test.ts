import { test } from "node:test"
import assert from "node:assert/strict"
import { SANDBOX_KEY, STATUSES } from "../src/modules/tasks/lib/constants.ts"
import { buildSandboxSeed, nextSandboxReset, sandboxStale } from "../src/modules/tasks/lib/sandbox.ts"
import { boardView, buildStatus, entityTasks } from "../src/workflows/tasks/read.ts"
import { contextOf } from "../src/workflows/tasks/context.ts"
import { ensureSandbox, resetSandbox, seedTargets } from "../src/workflows/tasks/sandbox.ts"
import { addComment, createTask, updateTask } from "../src/workflows/tasks/tasks.ts"
import { ActionError } from "../src/workflows/tasks/runtime.ts"
import sandboxJob from "../src/jobs/tasks-sandbox.ts"
import { DEFAULT_OPTIONS, setup } from "./helpers.ts"

const NOW = new Date("2026-10-07T10:00:00Z")
const VIEWER = { id: "user_demo", name: "Demo" }
const ENTITIES = { productId: "prod_1", orderId: "order_1", customerId: "cus_1" }

test("seed: a week of a store on all six columns, deterministic", () => {
  const a = buildSandboxSeed({ now: NOW, viewer: VIEWER, entities: ENTITIES })
  const b = buildSandboxSeed({ now: NOW, viewer: VIEWER, entities: ENTITIES })
  assert.deepEqual(a, b)
  assert.equal(a.tasks.length, 9)
  assert.deepEqual([...new Set(a.tasks.map((t) => t.status))].sort(), [...STATUSES].sort())
  for (const s of STATUSES) {
    const positions = a.tasks.filter((t) => t.status === s).map((t) => t.position)
    assert.deepEqual(positions, positions.map((_, i) => i), `${s} numbered from 0`)
  }
  assert.ok(a.tasks.every((t) => /^task_sbx_\d{2}$/.test(t.id)), "recognisable ids")
  assert.ok(a.tasks.some((t) => t.due_date && t.due_date < NOW && t.status !== "done"), "one task is overdue")
  assert.ok(a.tasks.filter((t) => t.status === "done" || t.status === "rejected").every((t) => t.completed_at))
  assert.deepEqual([...new Set(a.comments.map((c) => c.author_role))].sort(), ["agency", "claude", "client"])
  assert.deepEqual(a.marker, { version: "0.1.0", seeded_at: NOW.toISOString(), tasks: 9, comments: a.comments.length, links: a.links.length })
})

test("seed: both admin languages for every sample text, and no dashes or middle dots", () => {
  const seed = buildSandboxSeed({ now: NOW, viewer: VIEWER, entities: ENTITIES })
  const texts: string[] = []
  for (const t of seed.tasks) {
    const sample = (t.metadata as { sample: { title: { en: string; pl: string }; description: { en: string; pl: string } } }).sample
    assert.equal(t.title, sample.title.en)
    assert.ok(sample.title.pl && sample.description.pl && sample.description.en)
    texts.push(sample.title.en, sample.title.pl, sample.description.en, sample.description.pl)
  }
  for (const c of seed.comments) {
    const body = (c.metadata as { sample: { body: { en: string; pl: string } } }).sample.body
    assert.equal(c.body, body.en)
    texts.push(body.en, body.pl)
  }
  for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014\u00b7]/, text)
  assert.ok(texts.some((t) => /[ąćęłńóśźż]/.test(t)), "Polish with its letters")
})

test("seed: links only to records the store has; the viewer gets tasks of their own", () => {
  const full = buildSandboxSeed({ now: NOW, viewer: VIEWER, entities: ENTITIES })
  assert.deepEqual([...new Set(full.links.map((l) => l.entity_type))].sort(), ["customer", "order", "product"])
  assert.ok(full.links.every((l) => full.tasks.some((t) => t.id === l.task_id)))
  assert.ok(full.tasks.filter((t) => t.assignee_id === "user_demo").length >= 2)
  const bare = buildSandboxSeed({ now: NOW, viewer: null, entities: {} })
  assert.deepEqual(bare.links, [])
  assert.ok(bare.tasks.every((t) => t.assignee_id === null), "without a viewer the sample people take their tasks")
  assert.ok(!bare.activity.some((a) => a.type === "linked"))
})

test("staleness: a missing marker, another version or an old seed means seeding again; 0 hours means only by hand", () => {
  const fresh = { version: "0.1.0", seeded_at: NOW.toISOString() }
  assert.equal(sandboxStale(null, 24, NOW), true)
  assert.equal(sandboxStale({ ...fresh, version: "0.0.1" }, 24, NOW), true)
  assert.equal(sandboxStale(fresh, 24, new Date(NOW.getTime() + 23 * 3_600_000)), false)
  assert.equal(sandboxStale(fresh, 24, new Date(NOW.getTime() + 24 * 3_600_000)), true)
  assert.equal(sandboxStale(fresh, 0, new Date(NOW.getTime() + 1000 * 3_600_000)), false)
  assert.equal(sandboxStale({ version: "0.1.0", seeded_at: "garbage" }, 24, NOW), true)
  assert.equal(nextSandboxReset(NOW.toISOString(), 24), "2026-10-08T10:00:00.000Z")
  assert.equal(nextSandboxReset(NOW.toISOString(), 0), null)
  assert.equal(nextSandboxReset(null, 24), null)
})

test("flows: reads never seed; the page of a sandbox account asks for it once; the team never seeds", async () => {
  const s = setup({ ...DEFAULT_OPTIONS, sandboxSeedLinks: "all" })
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  assert.equal(await ensureSandbox(s.container, team), false)
  assert.equal(s.memory.tasks.size, 0)
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  /* Every read of the sandbox account leaves the board as it is. */
  assert.equal((await boardView(s.container, demo)).tasks.length, 0)
  assert.equal((await entityTasks(s.container, demo, "order", "order_1")).count, 0)
  assert.equal((await buildStatus(s.container, demo)).sandbox_board.stale, true)
  assert.equal(s.memory.tasks.size, 0, "no read seeded anything")
  assert.equal(s.memory.settings.size, 0)
  /* The page asks. */
  assert.equal(await ensureSandbox(s.container, demo), true)
  const board = await boardView(s.container, demo)
  assert.equal(board.tasks.length, 9)
  assert.ok(board.tasks.every((t) => t.board === "sandbox"))
  assert.equal((await buildStatus(s.container, demo)).sandbox_board.stale, false)
  assert.equal(await ensureSandbox(s.container, demo), false, "fresh: no second seed")
  const widget = await entityTasks(s.container, demo, "order", "order_1")
  assert.equal(widget.count, 1)
  assert.equal(widget.sandbox, true)
})

test("seed links: by default the sample tasks link only to a product; all links to the newest order and customer; none to nothing", async () => {
  for (const [links, expected] of [
    [undefined, ["product"]],
    ["all", ["customer", "order", "product"]],
    ["none", []],
  ] as const) {
    const s = setup({ ...DEFAULT_OPTIONS, ...(links ? { sandboxSeedLinks: links } : {}) })
    const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
    await ensureSandbox(s.container, demo)
    const types = [...new Set([...s.memory.links.values()].map((l) => l.entity_type))].sort()
    assert.deepEqual(types, expected, `sandboxSeedLinks ${links ?? "default"}`)
  }
  assert.deepEqual(seedTargets({ productId: "prod_1", orderId: "order_1", customerId: "cus_1" }, "product"), { productId: "prod_1" })
})

test("flows: a reset brings the sample tasks back and removes what visitors added; it needs sandbox accounts", async () => {
  const s = setup()
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await ensureSandbox(s.container, demo)
  await createTask(s.container, demo, { title: "Visitor's task" })
  assert.equal([...s.memory.tasks.values()].filter((t) => t.board === "sandbox").length, 10)
  /* A reset seconds after the seed changes nothing (a double click); later it does. */
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  await resetSandbox(s.container, team)
  assert.equal([...s.memory.tasks.values()].filter((t) => t.board === "sandbox").length, 10, "within the cooldown")
  const marker = s.memory.settings.get(SANDBOX_KEY)
  assert.ok(marker)
  ;(marker.value as { seeded_at: string }).seeded_at = new Date(Date.now() - 60_000).toISOString()
  const r = await resetSandbox(s.container, team)
  assert.equal(r.ok, true)
  const after = (await boardView(s.container, demo)).tasks
  assert.equal(after.length, 9)
  assert.ok(!after.some((t) => t.title === "Visitor's task"))
  assert.ok(s.memory.settings.get(SANDBOX_KEY))
  const off = setup({})
  try {
    await resetSandbox(off.container, await contextOf(off.container, { actor_id: "user_team", actor_type: "user" }))
    assert.fail("expected a refusal")
  } catch (err) {
    assert.ok(err instanceof ActionError)
    assert.equal(err.code, "sandbox_off")
  }
})

test("flows: an old seed is replaced by the page or the job after sandboxResetHours, never by a read", async () => {
  const s = setup({ sandboxAccounts: ["demo@store.example"], sandboxResetHours: 1 })
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await ensureSandbox(s.container, demo)
  await createTask(s.container, demo, { title: "Visitor's task" })
  const marker = s.memory.settings.get(SANDBOX_KEY)
  assert.ok(marker)
  ;(marker.value as { seeded_at: string }).seeded_at = new Date(Date.now() - 2 * 3_600_000).toISOString()
  assert.equal((await boardView(s.container, demo)).tasks.length, 10, "a read leaves the old board")
  await sandboxJob(s.container as never)
  assert.equal((await boardView(s.container, demo)).tasks.length, 9, "the job reseeded it")
  const quiet = setup({})
  await sandboxJob(quiet.container as never)
  assert.equal(quiet.memory.settings.size, 0, "without sandbox accounts the job does nothing")
})

test("limits: the shared sandbox board caps tasks, comments per task and changes per minute; the team's board does not", async () => {
  const s = setup({ ...DEFAULT_OPTIONS, sandboxLimits: { tasks: 11, commentsPerTask: 1, writesPerMinute: 7 } })
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await ensureSandbox(s.container, demo)
  const mine = await createTask(s.container, demo, { title: "One more" })
  await createTask(s.container, demo, { title: "Two more" })
  await assert.rejects(createTask(s.container, demo, { title: "Too many" }), (err: unknown) => err instanceof ActionError && err.status === 409 && err.code === "sandbox_full")
  await addComment(s.container, demo, mine.id, { body: "first" })
  await assert.rejects(addComment(s.container, demo, mine.id, { body: "second" }), (err: unknown) => err instanceof ActionError && err.code === "sandbox_full")
  /* Every attempt counts, the refused ones too: five so far, the seventh is the last one this minute. */
  await updateTask(s.container, demo, mine.id, { priority: "high" })
  await updateTask(s.container, demo, mine.id, { priority: "low" })
  await assert.rejects(updateTask(s.container, demo, mine.id, { priority: "urgent" }), (err: unknown) => err instanceof ActionError && err.status === 429 && err.code === "sandbox_busy")
  /* Another sandbox account has its own pace. */
  const other = await contextOf(s.container, { actor_id: "user_demo2", actor_type: "user" })
  await updateTask(s.container, other, mine.id, { priority: "urgent" })
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  for (let i = 0; i < 15; i++) await createTask(s.container, team, { title: `Team ${i}` })
  assert.equal([...s.memory.tasks.values()].filter((t) => t.board === "main").length, 15)
})
