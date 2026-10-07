/**
 * The pure rules of the admin: the board after a drag (the same order the
 * server writes), the due date the drawer sends only once it is whole, and
 * the photos it shows (https or image data, never a referrer).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { completeDay, moveOnBoard, safeAvatarUrl } from "../src/admin/lib/tasks-rules.ts"
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
