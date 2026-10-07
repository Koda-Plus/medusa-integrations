import { test } from "node:test"
import assert from "node:assert/strict"
import { SANDBOX_KEY, STATUSES } from "../src/modules/tasks/lib/constants.ts"
import { buildSandboxSeed, nextSandboxReset, sandboxStale } from "../src/modules/tasks/lib/sandbox.ts"
import { boardView, entityTasks } from "../src/workflows/tasks/read.ts"
import { contextOf } from "../src/workflows/tasks/context.ts"
import { ensureSandbox, resetSandbox } from "../src/workflows/tasks/sandbox.ts"
import { createTask } from "../src/workflows/tasks/tasks.ts"
import { ActionError } from "../src/workflows/tasks/runtime.ts"
import { setup } from "./helpers.ts"

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

test("flows: the first sandbox visit seeds the board; the team's visits never do", async () => {
  const s = setup()
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  assert.equal(await ensureSandbox(s.container, team), false)
  assert.equal(s.memory.tasks.size, 0)
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  const board = await boardView(s.container, demo)
  assert.equal(board.tasks.length, 9)
  assert.ok(board.tasks.every((t) => t.board === "sandbox"))
  assert.equal(await ensureSandbox(s.container, demo), false, "fresh: no second seed")
  const widget = await entityTasks(s.container, demo, "order", "order_1")
  assert.equal(widget.count, 1)
  assert.equal(widget.sandbox, true)
})

test("flows: a reset brings the sample tasks back and removes what visitors added; it needs sandbox accounts", async () => {
  const s = setup()
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await boardView(s.container, demo)
  await createTask(s.container, demo, { title: "Visitor's task" })
  assert.equal([...s.memory.tasks.values()].filter((t) => t.board === "sandbox").length, 10)
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
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

test("flows: an old seed is replaced on the next visit after sandboxResetHours", async () => {
  const s = setup({ sandboxAccounts: ["demo@store.example"], sandboxResetHours: 1 })
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await boardView(s.container, demo)
  await createTask(s.container, demo, { title: "Visitor's task" })
  const marker = s.memory.settings.get(SANDBOX_KEY)
  assert.ok(marker)
  ;(marker.value as { seeded_at: string }).seeded_at = new Date(Date.now() - 2 * 3_600_000).toISOString()
  const board = await boardView(s.container, demo)
  assert.equal(board.tasks.length, 9, "reseeded")
})
