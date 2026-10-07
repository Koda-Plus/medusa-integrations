import { test } from "node:test"
import assert from "node:assert/strict"
import { STATUSES } from "../src/modules/tasks/lib/constants.ts"
import { completedAtAfter, isClosedStatus, isOpenStatus, isUrgent, normalizePriority, normalizeStatus } from "../src/modules/tasks/lib/status.ts"
import { isDay, isOverdue, parseDueDate, todayOf, utcDay } from "../src/modules/tasks/lib/dates.ts"
import { compareColumn, nextPosition, planMove, positionChanges, sortColumn } from "../src/modules/tasks/lib/positions.ts"

const now = new Date("2026-10-07T12:00:00Z")
const before = new Date("2026-10-01T09:00:00Z")

test("status transitions: every status can follow every other one; completed_at follows open and closed", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const at = completedAtAfter(from, to, isClosedStatus(from) ? before : null, now)
      if (!isClosedStatus(to)) assert.equal(at, null, `${from} -> ${to} clears completed_at`)
      else if (isClosedStatus(from)) assert.equal(at, before, `${from} -> ${to} keeps the first completion`)
      else assert.equal(at, now, `${from} -> ${to} completes now`)
    }
  }
  assert.equal(completedAtAfter("done", "rejected", null, now), now, "a closed task without a date gets one")
})

test("status: unknown values of old rows read as backlog and medium; urgent counts only open tasks", () => {
  assert.equal(normalizeStatus("in_progress"), "in_progress")
  assert.equal(normalizeStatus("archived"), "backlog")
  assert.equal(normalizeStatus(null), "backlog")
  assert.equal(normalizePriority("critical"), "medium")
  assert.equal(isOpenStatus("review"), true)
  assert.equal(isOpenStatus("done"), false)
  assert.equal(isClosedStatus("rejected"), true)
  assert.equal(isUrgent("urgent", "todo"), true)
  assert.equal(isUrgent("high", "in_progress"), true)
  assert.equal(isUrgent("urgent", "done"), false)
  assert.equal(isUrgent("medium", "todo"), false)
})

test("due dates: a day is stored at noon UTC, an ISO timestamp as it is, null and empty clear it", () => {
  assert.deepEqual(parseDueDate("2026-10-12"), { ok: true, value: new Date("2026-10-12T12:00:00.000Z") })
  assert.deepEqual(parseDueDate("2026-10-12T08:30:00Z"), { ok: true, value: new Date("2026-10-12T08:30:00Z") })
  assert.deepEqual(parseDueDate(null), { ok: true, value: null })
  assert.deepEqual(parseDueDate(""), { ok: true, value: null })
  for (const bad of ["2026-02-30", "12.10.2026", "tomorrow", "1999-01-01", "2026-10-12Tnope", 20261012, {}]) assert.equal(parseDueDate(bad).ok, false, String(bad))
  assert.equal(isDay("2028-02-29"), true)
  assert.equal(isDay("2027-02-29"), false)
  assert.equal(utcDay(new Date("2026-10-12T12:00:00Z")), "2026-10-12")
  assert.equal(utcDay(null), null)
})

test("overdue: an open task whose due day is before today; closed tasks never are", () => {
  assert.equal(isOverdue({ status: "todo", due_date: "2026-10-06T12:00:00Z" }, "2026-10-07"), true)
  assert.equal(isOverdue({ status: "todo", due_date: "2026-10-07T12:00:00Z" }, "2026-10-07"), false, "due today is not late yet")
  assert.equal(isOverdue({ status: "done", due_date: "2026-01-01T12:00:00Z" }, "2026-10-07"), false)
  assert.equal(isOverdue({ status: "review", due_date: null }, "2026-10-07"), false)
  assert.equal(todayOf("2026-10-08", now), "2026-10-08", "the admin's own calendar day")
  assert.equal(todayOf("garbage", now), "2026-10-07")
})

test("positions: a move names neighbours; after wins, then before, else the end", () => {
  const col = ["a", "b", "c", "d"]
  assert.deepEqual(planMove(col, "d", { afterId: "a" }), ["a", "d", "b", "c"])
  assert.deepEqual(planMove(col, "a", { beforeId: "d" }), ["b", "c", "a", "d"])
  assert.deepEqual(planMove(col, "b", { afterId: "c", beforeId: "a" }), ["a", "c", "b", "d"], "after wins over before")
  assert.deepEqual(planMove(col, "b", { afterId: "gone", beforeId: "d" }), ["a", "c", "b", "d"], "a stale neighbour falls back to the other")
  assert.deepEqual(planMove(col, "b", {}), ["a", "c", "d", "b"], "no neighbours: the end")
  assert.deepEqual(planMove(col, "b", { afterId: "b" }), ["a", "c", "d", "b"], "the card itself is never its own neighbour")
  assert.deepEqual(planMove(["x", "y"], "new", { beforeId: "x" }), ["new", "x", "y"], "a card from another column")
  assert.deepEqual(planMove([], "new"), ["new"])
})

test("positions: only rows whose number changes are written; old rows sharing position 0 keep a stable order", () => {
  const rows = [
    { id: "a", position: 0, created_at: "2026-10-01T00:00:00Z" },
    { id: "b", position: 1, created_at: "2026-10-01T00:00:00Z" },
    { id: "c", position: 2, created_at: "2026-10-01T00:00:00Z" },
  ]
  assert.deepEqual(positionChanges(rows, ["a", "c", "b"]), [
    { id: "c", position: 1 },
    { id: "b", position: 2 },
  ])
  assert.deepEqual(positionChanges(rows, ["a", "b", "c"]), [])
  const legacy = [
    { id: "z", position: 0, created_at: "2026-06-02T00:00:00Z" },
    { id: "y", position: 0, created_at: "2026-06-01T00:00:00Z" },
    { id: "x", position: 0, created_at: "2026-06-01T00:00:00Z" },
  ]
  assert.deepEqual(sortColumn(legacy).map((r) => r.id), ["x", "y", "z"], "creation time, then id")
  assert.ok(compareColumn(legacy[1], legacy[0]) < 0)
  assert.equal(nextPosition([]), 0)
  assert.equal(nextPosition([0, 4, 2]), 5)
})
