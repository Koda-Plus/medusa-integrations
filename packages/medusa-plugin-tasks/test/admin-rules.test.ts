/**
 * The pure rules of the admin: the board after a drag (the same order the
 * server writes), the due date the drawer sends only once it is whole, and
 * the photos it shows (https or image data, never a referrer).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { NO_FILTERS, applyFilters, completeDay, errorKeys, filtered, filtersFromParams, filtersToParams, moveOnBoard, safeAvatarUrl, type BoardFilters } from "../src/admin/lib/tasks-rules.ts"
import type { BoardResponse, TaskDto } from "../src/modules/tasks/lib/contract.ts"

const task = (id: string, status: TaskDto["status"], position: number, completed_at: string | null = null): TaskDto =>
  ({ id, status, position, completed_at, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" }) as TaskDto

function board(tasks: TaskDto[]): BoardResponse {
  return { tasks, counts: {} as BoardResponse["counts"], hidden_closed: 0, hidden_open: 0 }
}

test("board: a drag places the card between its neighbours and numbers the column it left", () => {
  const b = board([task("a", "todo", 0), task("b", "todo", 1), task("c", "todo", 2), task("x", "review", 0)])
  const after = moveOnBoard(b, { id: "a", status: "review", after_id: "x", before_id: null })
  const pos = Object.fromEntries(after.tasks.map((t) => [t.id, [t.status, t.position]]))
  assert.deepEqual(pos, { a: ["review", 1], b: ["todo", 0], c: ["todo", 1], x: ["review", 0] })
})

test("board: a drop in done changes the status only and stamps completed_at; leaving done numbers nothing there", () => {
  const b = board([task("a", "todo", 0), task("b", "todo", 1), task("d1", "done", 0, "2026-10-02T00:00:00.000Z"), task("d2", "done", 0, "2026-10-03T00:00:00.000Z")])
  const closed = moveOnBoard(b, { id: "a", status: "done", after_id: "d1", before_id: null })
  const a = closed.tasks.find((t) => t.id === "a")
  assert.equal(a?.status, "done")
  assert.ok(a?.completed_at)
  assert.deepEqual(closed.tasks.filter((t) => t.id.startsWith("d")).map((t) => t.position), [0, 0], "done cards keep their numbers")
  assert.equal(closed.tasks.find((t) => t.id === "b")?.position, 0, "the todo column closes its gap")
  const reopened = moveOnBoard(closed, { id: "d1", status: "todo", after_id: null, before_id: "b" })
  assert.deepEqual(
    reopened.tasks.filter((t) => t.status === "todo").map((t) => [t.id, t.position]).sort(),
    [["b", 1], ["d1", 0]],
  )
  assert.equal(reopened.tasks.find((t) => t.id === "d1")?.completed_at, null)
})

test("due date: only a whole date between 2000 and 2100 is sent", () => {
  for (const partial of ["0002-10-07", "0020-10-07", "0202-10-07", "2026-10", "", "2101-01-01"]) assert.equal(completeDay(partial), false, partial)
  assert.equal(completeDay("2026-10-07"), true)
  assert.equal(completeDay("2000-01-01"), true)
})

test("avatars: https and image data only", () => {
  assert.equal(safeAvatarUrl("https://cdn.example/a.png"), "https://cdn.example/a.png")
  assert.equal(safeAvatarUrl(" data:image/png;base64,iVBORw0KGgo= "), "data:image/png;base64,iVBORw0KGgo=")
  for (const bad of ["http://tracker.example/p.gif", "javascript:alert(1)", "//evil.example/x.png", "data:text/html;base64,PHNjcmlwdD4=", "https://a.example/x.png\" onerror=\"x", null, undefined])
    assert.equal(safeAvatarUrl(bad as string | null | undefined), null, String(bad))
})

const full = (over: Partial<TaskDto>): TaskDto =>
  ({
    id: "t",
    title: "Task",
    description: null,
    status: "todo",
    priority: "medium",
    assignee: null,
    assignee_id: null,
    due_date: null,
    tags: [],
    links: [],
    sample: null,
    position: 0,
    completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...over,
  }) as TaskDto

test("deep links: every counter and summary link opens a filter the page reads; unknown values are ignored", () => {
  for (const href of ["/tasks?quick=overdue&record_type=order", "/tasks?quick=overdue&record_type=product", "/tasks?quick=overdue&record_type=customer", "/tasks?quick=unassigned", "/tasks?quick=mine", "/tasks?record=order%3Aorder_01ABC"]) {
    const f = filtersFromParams(new URL(href, "https://admin.example.com").searchParams)
    assert.ok(filtered(f), href)
  }
  const f = filtersFromParams(new URLSearchParams("quick=overdue&record_type=order&assignee=me&priority=high&tag=release&q=refund&record=order:order_1"))
  assert.deepEqual(f, { q: "refund", assignee: "me", tag: "release", priority: "high", quick: "overdue", record: "order:order_1", recordType: "order" })
  const junk = filtersFromParams(new URLSearchParams("quick=everything&record_type=invoice&assignee=admin&priority=asap&record=order:../x"))
  assert.deepEqual(junk, NO_FILTERS)
  /* Back to the URL: other parameters stay, defaults are dropped. */
  const p = filtersToParams({ ...NO_FILTERS, quick: "mine", record: "product:prod_1" }, new URLSearchParams("view=panel&task=task_1&q=old"))
  assert.equal(p.toString(), "view=panel&task=task_1&quick=mine&record=product%3Aprod_1")
})

test("filters: quick filters, the record and the kind of record, me and mine", () => {
  const link = (type: "order" | "product" | "customer", entity_id: string) => ({ id: `l_${entity_id}`, type, entity_id, label: entity_id, found: true, created_by: null, created_at: "" })
  const tasks = [
    full({ id: "late", due_date: "2026-10-01T12:00:00.000Z", links: [link("order", "order_1")], assignee_id: "user_me" }),
    full({ id: "today", due_date: "2026-10-07T12:00:00.000Z", links: [link("product", "prod_1")] }),
    full({ id: "review", status: "review", assignee: "Anna" }),
    full({ id: "done", status: "done", due_date: "2026-01-01T12:00:00.000Z", assignee_id: "user_me", links: [link("order", "order_2")] }),
  ]
  const ids = (f: Partial<BoardFilters>) => applyFilters(tasks, { ...NO_FILTERS, ...f }, "2026-10-07", "en", "user_me").map((t) => t.id)
  assert.deepEqual(ids({ quick: "overdue" }), ["late"])
  assert.deepEqual(ids({ quick: "due_today" }), ["today"])
  assert.deepEqual(ids({ quick: "unassigned" }), ["today"])
  assert.deepEqual(ids({ quick: "mine" }), ["late"], "open tasks of the person asking")
  assert.deepEqual(ids({ quick: "open" }), ["late", "today", "review"])
  assert.deepEqual(ids({ quick: "review" }), ["review"])
  assert.deepEqual(ids({ assignee: "me" }), ["late", "done"])
  assert.deepEqual(ids({ recordType: "order" }), ["late", "done"])
  assert.deepEqual(ids({ quick: "overdue", recordType: "order" }), ["late"], "the overdue_orders counter")
  assert.deepEqual(ids({ record: "order:order_2" }), ["done"])
  assert.deepEqual(ids({ assignee: "text:anna" }), ["review"])
  assert.deepEqual(applyFilters(tasks, { ...NO_FILTERS, quick: "mine" }, "2026-10-07", "en", null), [], "without a viewer nobody is me")
})

test("errors: the field's own code first (other_board, too_long), then the refusal's; both dictionaries have them", async () => {
  assert.deepEqual(errorKeys("invalid_data", "other_board"), ["errors.fields.other_board", "errors.invalid_data"])
  assert.deepEqual(errorKeys("sandbox_busy", null), ["errors.sandbox_busy"])
  assert.deepEqual(errorKeys(null, "../x"), [])
  const { default: en } = await import("../src/admin/i18n/en.ts")
  const codes = ["author_reserved", "conflict_retry", "sandbox_full", "sandbox_busy", "sandbox_guard", "agent_key_scope", "json_required", "server_error", "other_board", "key_owner_missing"]
  for (const c of codes) assert.equal(typeof (en.errors as Record<string, unknown>)[c], "string", c)
  for (const f of ["required", "invalid", "too_long", "too_many", "empty", "not_found", "other_board", "author_reserved"]) assert.equal(typeof en.errors.fields[f as keyof typeof en.errors.fields], "string", f)
})
