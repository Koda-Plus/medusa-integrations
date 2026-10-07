/**
 * The shapes other code builds on: the event payloads, the activity log as
 * the admin reads it (old KODA Panel rows included), and the answers of the
 * admin API built from rows.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { COMMENT_CREATED, TASK_CREATED, TASK_DELETED, TASK_EVENTS, TASK_STATUS_CHANGED, TASK_UPDATED, commentEventData, eventsForUpdate, taskEventData, type EventTask } from "../src/modules/tasks/lib/events.ts"
import { assignedEntry, createdEntry, describeActivity, linkedEntry, statusEntry, unlinkedEntry, updatedEntry } from "../src/modules/tasks/lib/activity.ts"
import { countsFrom, eventTask, roleOf, tagsOf, taskSample, toCommentDto, toTaskDto } from "../src/modules/tasks/lib/dto.ts"
import { apiKeyContext, userContext } from "../src/modules/tasks/lib/actor.ts"
import { resolveOptions } from "../src/modules/tasks/lib/options.ts"
import type { TaskRow } from "../src/modules/tasks/lib/rows.ts"

const opts = resolveOptions({ sandboxAccounts: ["demo@store.example"], agencyAccounts: ["@agency.example"] })

const task: EventTask = {
  id: "task_1",
  board: "main",
  title: "Ship it",
  status: "review",
  priority: "high",
  assignee: "Ola",
  assignee_id: null,
  due_date: new Date("2026-10-12T12:00:00Z"),
  tags: ["release"],
  links: [{ type: "order", id: "order_1" }],
}

test("events: five names under the tasks namespace", () => {
  assert.deepEqual([...TASK_EVENTS], ["tasks.task.created", "tasks.task.updated", "tasks.task.status_changed", "tasks.task.deleted", "tasks.comment.created"])
  assert.deepEqual([TASK_CREATED, TASK_UPDATED, TASK_STATUS_CHANGED, TASK_DELETED, COMMENT_CREATED], [...TASK_EVENTS])
})

test("events: the task payload, with the actor and demo for the sandbox board", () => {
  const actor = userContext({ id: "user_1", email: "ola@agency.example", first_name: "Ola" }, opts).actor
  const data = taskEventData(task, { previousStatus: "in_progress", actor, changes: ["priority"] })
  assert.deepEqual(data, {
    id: "task_1",
    board: "main",
    title: "Ship it",
    status: "review",
    previous_status: "in_progress",
    priority: "high",
    assignee: "Ola",
    assignee_id: null,
    due_date: "2026-10-12T12:00:00.000Z",
    tags: ["release"],
    links: [{ type: "order", id: "order_1" }],
    changes: ["priority"],
    actor: { type: "user", id: "user_1", name: "Ola", role: "agency" },
    demo: false,
  })
  assert.equal(taskEventData({ ...task, board: "sandbox" }, { previousStatus: null, actor }).demo, true)
  assert.deepEqual(taskEventData(task, { previousStatus: null, actor }).changes, [])
})

test("events: the comment payload names the comment and its task", () => {
  const agent = apiKeyContext({ id: "apk_1", title: "Deploy bot", created_by: null }, null, "Claude Code", opts).actor
  const data = commentEventData(task, { id: "tcom_1", author_role: "claude" }, agent)
  assert.deepEqual(data, {
    id: "tcom_1",
    task_id: "task_1",
    board: "main",
    title: "Ship it",
    status: "review",
    priority: "high",
    assignee: "Ola",
    assignee_id: null,
    links: [{ type: "order", id: "order_1" }],
    author_role: "claude",
    actor: { type: "api-key", id: "apk_1", name: "Claude Code", role: "claude" },
    demo: false,
  })
})

test("events: an update announces a status change and the other changes, each when there is one", () => {
  assert.deepEqual(eventsForUpdate("todo", "done", []), [TASK_STATUS_CHANGED])
  assert.deepEqual(eventsForUpdate("todo", "todo", ["title"]), [TASK_UPDATED])
  assert.deepEqual(eventsForUpdate("todo", "review", ["tags"]), [TASK_STATUS_CHANGED, TASK_UPDATED])
  assert.deepEqual(eventsForUpdate("todo", "todo", []), [])
})

test("activity: new entries carry the facts; old KODA Panel rows read from their text", () => {
  assert.deepEqual(describeActivity({ ...statusEntry("todo", "done") }), { kind: "moved", from: "todo", to: "done" })
  assert.deepEqual(describeActivity({ type: "status_changed", message: "Zmieniono status: todo / done", metadata: null }), { kind: "moved", from: "todo", to: "done" })
  assert.deepEqual(describeActivity({ type: "status_changed", message: "in_progress -> review", metadata: null }), { kind: "moved", from: "in_progress", to: "review" })
  assert.deepEqual(describeActivity({ type: "status_changed", message: "Zmieniono status: todo \u2192 done", metadata: null }), { kind: "moved", from: "todo", to: "done" })
  assert.deepEqual(describeActivity({ type: "status_changed", message: "Status zmieniony", metadata: null }), { kind: "status" })
  assert.deepEqual(describeActivity({ type: "task_created", message: "Utworzono zadanie \"X\"", metadata: null }), { kind: "created" })
  assert.deepEqual(describeActivity({ type: "commented", message: "Nowy komentarz (Koda AI)", metadata: null }), { kind: "commented" })
  assert.deepEqual(describeActivity({ ...assignedEntry({ id: null, name: null }, { id: "user_1", name: "Anna" }) }), { kind: "assigned", name: "Anna" })
  assert.deepEqual(describeActivity({ ...assignedEntry({ id: "user_1", name: "Anna" }, { id: null, name: null }) }), { kind: "unassigned" })
  assert.deepEqual(describeActivity({ ...linkedEntry("order", "order_1") }), { kind: "linked", linkType: "order", entityId: "order_1" })
  assert.deepEqual(describeActivity({ ...unlinkedEntry("product", "prod_1") }), { kind: "unlinked", linkType: "product", entityId: "prod_1" })
  assert.deepEqual(describeActivity({ ...updatedEntry(["title", "tags"]) }), { kind: "updated", fields: ["title", "tags"] })
  assert.deepEqual(describeActivity({ type: "something_new", message: "Hello", metadata: null }), { kind: "other", text: "Hello" })
  assert.equal(createdEntry({ status: "todo", priority: "low" }).message, "Created the task")
})

const row = (over: Partial<TaskRow>): TaskRow => ({
  id: "01J9ZK8N1Q2R3S4T5V6W7X8Y9Z",
  board: "main",
  title: "Old roadmap item",
  description: null,
  status: "todo",
  priority: "medium",
  assignee: "Koda AI",
  assignee_id: null,
  due_date: "2026-10-31T12:00:00.000Z",
  tags: ["backend"],
  position: 0,
  completed_at: null,
  created_by: null,
  created_by_id: null,
  metadata: { adopted_from: "koda-panel" },
  created_at: "2026-06-23T10:00:00.000Z",
  updated_at: "2026-10-06T10:00:00.000Z",
  deleted_at: null,
  ...over,
})

test("answers: old rows read as they are, unknown values fall back, adopted rows are marked", () => {
  const dto = toTaskDto(row({}), { commentCount: 2 })
  assert.equal(dto.id, "01J9ZK8N1Q2R3S4T5V6W7X8Y9Z", "same ids as the KODA Panel")
  assert.equal(dto.adopted, true)
  assert.equal(dto.comment_count, 2)
  assert.equal(dto.due_date, "2026-10-31T12:00:00.000Z")
  assert.equal(toTaskDto(row({ status: "archived", priority: "critical" })).status, "backlog")
  assert.equal(toTaskDto(row({ status: "archived", priority: "critical" })).priority, "medium")
  assert.equal(toTaskDto(row({ board: "anything" })).board, "main")
  assert.deepEqual(tagsOf('["a", 1, " b "]'), ["a", "b"])
  assert.deepEqual(tagsOf("backend"), ["backend"])
  assert.deepEqual(tagsOf({ not: "a list" }), [])
  assert.equal(roleOf("koda"), "claude", "one copy of the module called the AI agent koda")
  assert.equal(roleOf("client"), "client")
  assert.equal(roleOf("whatever"), "agency")
  assert.deepEqual(taskSample({ sample: { title: { en: "A", pl: "B" }, description: "not text" } }), { title: { en: "A", pl: "B" } })
  assert.equal(taskSample(null), null)
})

test("answers: a comment is the reader's own only for the same person or key", () => {
  const c = { id: "c", board: "main", task_id: "t", body: "x", author: "Ola", author_role: "agency", author_id: "user_1", author_type: "user", metadata: null, edited_at: null, created_at: "2026-10-07T10:00:00Z", updated_at: "2026-10-07T10:00:00Z", deleted_at: null }
  assert.equal(toCommentDto(c, { type: "user", id: "user_1" }).own, true)
  assert.equal(toCommentDto(c, { type: "api-key", id: "user_1" }).own, false)
  assert.equal(toCommentDto(c, { type: "user", id: "user_2" }).own, false)
  assert.equal(toCommentDto({ ...c, author_id: null }, { type: "user", id: "user_1" }).own, false, "old comments belong to nobody")
})

test("answers: the counters add unknown statuses of old rows to the backlog", () => {
  const c = countsFrom([
    { status: "todo", count: 3, overdue: 1, urgent: 1, unassigned: 2 },
    { status: "archived", count: 2, overdue: 0, urgent: 0, unassigned: 0 },
    { status: "done", count: 4, overdue: 0, urgent: 0, unassigned: 0 },
  ])
  assert.deepEqual(c, { all: 9, backlog: 2, todo: 3, in_progress: 0, review: 0, done: 4, rejected: 0, open: 5, overdue: 1, urgent: 1, unassigned: 2 })
  const e = eventTask(row({}), [{ entity_type: "order", entity_id: "order_1" }, { entity_type: "invoice", entity_id: "x" }])
  assert.deepEqual(e.links, [{ type: "order", id: "order_1" }])
})
