/**
 * Tasks in the koda.integration/1 contract: the shared conformance checks,
 * for a team member and for a sandbox account, then what Tasks itself
 * promises: the worst linked task speaks (overdue red, due today or in
 * review orange, open blue, all closed green), "overdue" is counted by the
 * day of the request's time zone, metadata changes nothing, and the
 * contract routes keep exactly the board the plugin's own routes keep: a
 * sandbox account gets only sandbox data, a team member only the team's.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { tasksIntegration } from "../src/workflows/tasks/integration.ts"
import { dayIn, recordSummary, tasksCounters, type LinkedTask } from "../src/modules/tasks/lib/integration.ts"
import { makeContext } from "../src/modules/tasks/lib/kit-routes.ts"
import { contextOf } from "../src/workflows/tasks/context.ts"
import { createTask, updateTask } from "../src/workflows/tasks/tasks.ts"
import { conformance, fakeResponse } from "./kit-conformance.ts"
import { DEFAULT_OPTIONS, setup, type Setup } from "./helpers.ts"

const PAST = "2020-01-07"
const FAR = "2099-12-31"

/** The team's board and the sandbox board, each with tasks linked to the same records. */
async function sample(options = DEFAULT_OPTIONS): Promise<Setup> {
  const s = setup(options)
  const team = await contextOf(s.container, { actor_id: "user_team", actor_type: "user" })
  const demo = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  await createTask(s.container, team, { title: "Refund the damaged item", due_date: PAST, links: [{ type: "order", id: "order_1" }], assignee_id: "user_team" })
  await createTask(s.container, team, { title: "Check the invoice", status: "review", links: [{ type: "order", id: "order_1" }, { type: "customer", id: "cus_1" }] })
  await createTask(s.container, team, { title: "New photos", links: [{ type: "product", id: "prod_1" }], due_date: FAR })
  await createTask(s.container, team, { title: "Old cleanup", status: "done", links: [{ type: "product", id: "prod_2" }] })
  await createTask(s.container, team, { title: "Late product copy", due_date: PAST, links: [{ type: "product", id: "prod_1" }] })
  await createTask(s.container, demo, { title: "Demo visitor's late task", due_date: PAST, links: [{ type: "customer", id: "cus_1" }], assignee_id: "user_demo" })
  await createTask(s.container, demo, { title: "Demo visitor's order task", links: [{ type: "order", id: "order_1" }] })
  return s
}

/** Every change the fakes could make while answering, recorded. */
function recordWrites(s: Setup): () => string[] {
  const calls: string[] = []
  const WRITES = ["insertTask", "updateTask", "moveTask", "deleteTask", "insertComment", "updateComment", "deleteComment", "insertLink", "deleteLink"]
  const board = s.memory.stores.board
  s.memory.stores.board = (b) => {
    const store = board(b) as unknown as Record<string, unknown>
    for (const k of WRITES) {
      const fn = store[k] as (...a: unknown[]) => unknown
      store[k] = (...args: unknown[]) => {
        calls.push(`${b}.${k}`)
        return fn(...args)
      }
    }
    return store as never
  }
  const put = s.memory.stores.settings.put
  s.memory.stores.settings.put = (...args) => {
    calls.push("settings.put")
    return put(...args)
  }
  const replace = s.memory.stores.sandbox.replace
  s.memory.stores.sandbox.replace = (...args) => {
    calls.push("sandbox.replace")
    return replace(...args)
  }
  const bus = s.container.resolve<{ emit: (...a: unknown[]) => Promise<void> }>("event_bus")
  const emit = bus.emit
  bus.emit = (...args: unknown[]) => {
    calls.push("event_bus.emit")
    return emit(...args)
  }
  return () => calls
}

const team = (s: Setup, lang: "en" | "pl" = "en", tz = "UTC") => makeContext({ scope: s.container, lang, tz, actorId: "user_team", actorType: "user" })
const demo = (s: Setup, lang: "en" | "pl" = "en") => makeContext({ scope: s.container, lang, actorId: "user_demo", actorType: "user" })

{
  const s = await sample()
  conformance({ routes: tasksIntegration, scope: s.container, entity: "order", knownIds: ["order_1", "order_2"], writes: recordWrites(s), actorId: "user_team" })
}
{
  const s = await sample()
  conformance({ routes: tasksIntegration, scope: s.container, entity: "customer", knownIds: ["cus_1"], writes: recordWrites(s), actorId: "user_demo" })
}

test("summary: the worst linked task speaks, with counts and a link to the board filtered to the record", async () => {
  const s = await sample()
  const [order, unlinked] = await tasksIntegration.build.summaries(team(s), "order", ["order_1", "order_2"])
  assert.equal(order.state, "failed")
  assert.equal(order.tone, "red")
  assert.equal(order.title.fallback, "1 task overdue")
  assert.equal(order.detail?.fallback, "Most urgent: Refund the damaged item")
  assert.deepEqual(order.counts, { linked: 2, open: 2, overdue: 1, due_today: 0, review: 1, done: 0, rejected: 0 })
  assert.deepEqual(order.links, [{ kind: "admin", href: "/tasks?record=order%3Aorder_1" }])
  assert.equal(order.widget, "tasks.order")
  assert.deepEqual(order.facts, [])
  assert.equal(unlinked.state, "none", "metadata that looks like tasks changes nothing")
  const [product, closed] = await tasksIntegration.build.summaries(team(s, "pl"), "product", ["prod_1", "prod_2"])
  assert.equal(product.state, "failed")
  assert.equal(product.title.fallback, "1 zadanie po terminie")
  assert.equal(closed.state, "ok")
  assert.equal(closed.tone, "green")
  assert.equal(closed.title.fallback, "Zadanie zamknięte")
  const [customer] = await tasksIntegration.build.summaries(team(s), "customer", ["cus_1"])
  assert.deepEqual([customer.state, customer.title.fallback], ["attention", "1 task in review"])
})

test("summary rules: overdue beats due today beats review beats open beats closed; old statuses read as backlog", () => {
  const t = (id: string, status: string, due: string | null, priority = "medium"): LinkedTask => ({ id, title: id, status, priority, due_date: due ? `${due}T12:00:00.000Z` : null, updated_at: "2026-10-01T00:00:00.000Z" })
  const today = "2026-10-07"
  const state = (tasks: LinkedTask[]) => recordSummary("order", "order_1", tasks, today, "en")?.state
  assert.equal(state([t("a", "todo", null), t("b", "review", null), t("c", "in_progress", "2026-10-07"), t("d", "backlog", "2026-10-06")]), "failed")
  assert.equal(state([t("a", "todo", null), t("b", "review", null), t("c", "in_progress", "2026-10-07")]), "attention")
  assert.equal(recordSummary("order", "order_1", [t("a", "todo", null), t("c", "in_progress", "2026-10-07")], today, "en")?.title.key, "integration.record.dueToday")
  assert.equal(state([t("a", "todo", null), t("b", "review", null)]), "attention")
  assert.equal(state([t("a", "todo", null), t("b", "done", "2026-01-01")]), "active")
  assert.equal(state([t("a", "done", "2026-01-01"), t("b", "rejected", null)]), "ok")
  assert.equal(state([t("a", "someday", "2026-01-01")]), "failed", "an unknown status of an old row is open, like on the board")
  assert.equal(recordSummary("order", "order_1", [], today, "en"), undefined)
  /* A closed task past its due day is never overdue. */
  assert.equal(state([t("a", "done", "2020-01-01")]), "ok")
  /* The most urgent: the earliest due day, then the priority. */
  const s = recordSummary("order", "order_1", [t("later", "todo", "2026-12-01", "urgent"), t("sooner", "todo", "2026-11-01", "low"), t("nodate", "todo", null, "urgent")], today, "en")
  assert.equal(s?.detail?.params?.title, "sooner")
})

test("time zone: the request's day decides what is overdue", async () => {
  const late = new Date("2026-10-07T23:30:00.000Z")
  assert.equal(dayIn("UTC", late), "2026-10-07")
  assert.equal(dayIn("Europe/Warsaw", late), "2026-10-08")
  assert.equal(dayIn("America/Los_Angeles", late), "2026-10-07")
  assert.equal(dayIn("Not/AZone", late), "2026-10-07")
  const task: LinkedTask = { id: "t", title: "t", status: "todo", priority: "medium", due_date: "2026-10-07T12:00:00.000Z", updated_at: late }
  assert.equal(recordSummary("order", "o", [task], dayIn("UTC", late), "en")?.state, "attention", "due today in London")
  assert.equal(recordSummary("order", "o", [task], dayIn("Europe/Warsaw", late), "en")?.state, "failed", "already overdue in Warsaw")
})

test("counters: overdue tasks per kind of record, open tasks without a person, mine; each links to a filter of the board", async () => {
  const s = await sample()
  const a = await tasksIntegration.build.attention(team(s), ["orders", "products", "customers", "integration"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, [c.count, c.tone, c.scope, c.link.href]]))
  assert.deepEqual(by, {
    overdue_orders: [1, "orange", "orders", "/tasks?quick=overdue&record_type=order"],
    overdue_products: [1, "orange", "products", "/tasks?quick=overdue&record_type=product"],
    overdue_customers: [0, "orange", "customers", "/tasks?quick=overdue&record_type=customer"],
    unassigned: [3, "blue", "integration", "/tasks?quick=unassigned"],
    mine: [1, "blue", "integration", "/tasks?quick=mine"],
  })
  const orders = await tasksIntegration.build.attention(team(s), ["orders"])
  assert.deepEqual(orders.items.map((c) => c.key), ["overdue_orders"])
  /* A key has no tasks of its own. */
  const key = await tasksIntegration.build.attention(makeContext({ scope: s.container, actorId: "apk_team", actorType: "api-key" }), ["integration"])
  assert.equal(key.items.find((c) => c.key === "mine")?.count, 0)
  assert.equal(tasksCounters({ overdueOrders: 0, overdueProducts: 0, overdueCustomers: 0, unassigned: 0, mine: 0 }).length, 5)
})

test("sandbox: a sandbox account and its keys get only sandbox data from every entity and counter; the team never sees the sandbox", async () => {
  const s = await sample()
  for (const ctx of [demo(s), makeContext({ scope: s.container, actorId: "apk_demo", actorType: "api-key" })]) {
    const [order] = await tasksIntegration.build.summaries(ctx, "order", ["order_1"])
    assert.deepEqual([order.state, order.counts.linked, order.detail?.fallback], ["active", 1, "Most urgent: Demo visitor's order task"])
    const [product] = await tasksIntegration.build.summaries(ctx, "product", ["prod_1"])
    assert.equal(product.state, "none", "the team's product tasks do not exist for the sandbox")
    const [customer] = await tasksIntegration.build.summaries(ctx, "customer", ["cus_1"])
    assert.deepEqual([customer.state, customer.counts.linked], ["failed", 1])
    assert.doesNotMatch(JSON.stringify([order, product, customer]), /Refund|invoice|photos|cleanup|product copy/)
    const a = await tasksIntegration.build.attention(ctx, ["orders", "products", "customers", "integration"])
    const by = Object.fromEntries(a.items.map((c) => [c.key, c.count]))
    assert.deepEqual(by, { overdue_orders: 0, overdue_products: 0, overdue_customers: 1, unassigned: 1, mine: ctx.actor.type === "user" ? 1 : 0 })
    const m = await tasksIntegration.build.manifest(ctx)
    assert.deepEqual([m.mode, m.problems], ["sandbox", []], "a sandbox account hears nothing about the setup")
  }
  const [teamCustomer] = await tasksIntegration.build.summaries(team(s), "customer", ["cus_1"])
  assert.equal(teamCustomer.counts.linked, 1)
  assert.doesNotMatch(JSON.stringify(teamCustomer), /Demo visitor/)
  const m = await tasksIntegration.build.manifest(team(s))
  assert.equal(m.mode, "live")
  assert.deepEqual(m.problems.map((p) => p.key), ["integration.problem.sandbox_unguarded"], "the team hears that the sandbox has no guard")
  const guarded = await tasksIntegration.build.manifest(team(await sample({ ...DEFAULT_OPTIONS, sandboxGuard: true })))
  assert.deepEqual(guarded.problems, [])
  assert.equal(guarded.kind, "module")
  assert.deepEqual(
    guarded.widgets.map((w) => [w.id, w.zone]),
    [
      ["tasks.order", "order.details"],
      ["tasks.product", "product.details"],
      ["tasks.customer", "customer.details"],
    ],
  )
})

test("fail closed: an account that cannot be read gets no summary and no counters", async () => {
  const s = await sample()
  s.failUsers.on = true
  const unknown = makeContext({ scope: s.container, actorId: "user_nobody", actorType: "user" })
  const [order] = await tasksIntegration.build.summaries(unknown, "order", ["order_1"])
  assert.equal(order.state, "unavailable")
  const res = fakeResponse()
  await tasksIntegration.attention({ scope: s.container, query: {}, headers: {}, auth_context: { actor_id: "user_nobody", actor_type: "user" } } as never, res)
  assert.ok(res.statusCode >= 400)
  assert.doesNotMatch(JSON.stringify(res.body ?? {}), /Refund|Demo visitor/)
  const anonymous = fakeResponse()
  s.failUsers.on = false
  await tasksIntegration.attention({ scope: s.container, query: {}, headers: {}, auth_context: {} } as never, anonymous)
  assert.equal(anonymous.statusCode, 401)
})

test("summary: a sample task of the sandbox speaks in the admin's language", async () => {
  const s = await sample()
  const demoCtx = await contextOf(s.container, { actor_id: "user_demo", actor_type: "user" })
  const created = await createTask(s.container, demoCtx, { title: "Plain title", links: [{ type: "product", id: "prod_2" }] })
  const row = s.memory.tasks.get(created.id)
  assert.ok(row)
  row.metadata = { sample: { title: { en: "Sample in English", pl: "Przykład po polsku" } } }
  const [pl] = await tasksIntegration.build.summaries(demo(s, "pl"), "product", ["prod_2"])
  assert.equal(pl.detail?.fallback, "Najpilniejsze: Przykład po polsku")
  await updateTask(s.container, demoCtx, created.id, { status: "done" })
  const [done] = await tasksIntegration.build.summaries(demo(s, "en"), "product", ["prod_2"])
  assert.equal(done.detail?.fallback, "Latest: Sample in English")
})
