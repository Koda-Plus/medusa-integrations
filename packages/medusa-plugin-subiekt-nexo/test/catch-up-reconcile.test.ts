import { test } from "node:test"
import assert from "node:assert/strict"
import { catchUpWindow, planCatchUp } from "../src/modules/subiekt/lib/catch-up.ts"
import { compareOrderDocuments, findRemoteDocument, linkable, settleableStatus, taskSettledBy } from "../src/modules/subiekt/lib/reconcile.ts"
import { resolveOptions } from "../src/modules/subiekt/lib/options.ts"

const NOW = new Date("2026-11-02T12:00:00.000Z")
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

test("safety net options: on by default, 10 minutes to 7 days, clamped", () => {
  const o = resolveOptions({})
  assert.deepEqual([o.catchUpEnabled, o.catchUpMinAgeMinutes, o.catchUpMaxAgeDays], [true, 10, 7])
  const off = resolveOptions({ catchUpEnabled: "false" as unknown as boolean, catchUpMinAgeMinutes: 99_999, catchUpMaxAgeDays: 0 })
  assert.deepEqual([off.catchUpEnabled, off.catchUpMinAgeMinutes, off.catchUpMaxAgeDays], [false, 1440, 7])
})

test("the window: nothing before the plugin went live, never older than the maximum age", () => {
  assert.equal(catchUpWindow(NOW, 10, 7, null), null)
  assert.equal(catchUpWindow(NOW, 10, 7, "not a date"), null)

  const live = catchUpWindow(NOW, 10, 7, "2026-01-01T00:00:00.000Z")!
  assert.equal(live.from.toISOString(), "2026-10-26T12:00:00.000Z")
  assert.equal(live.to.toISOString(), "2026-11-02T11:50:00.000Z")

  // Configured yesterday: a week of older orders is never caught up.
  const recent = catchUpWindow(NOW, 10, 7, "2026-11-01T08:00:00.000Z")!
  assert.equal(recent.from.toISOString(), "2026-11-01T08:00:00.000Z")

  // The first task is younger than the minimum age: nothing to look at yet.
  assert.equal(catchUpWindow(NOW, 10, 7, minutesAgo(5)), null)
})

test("the plan: queue orders with no trace, recheck waiting tasks, skip everything decided", () => {
  const window = catchUpWindow(NOW, 10, 7, "2026-01-01T00:00:00.000Z")!
  const plan = planCatchUp(
    [
      { id: "order_new_b", status: "pending", created_at: minutesAgo(30) },
      { id: "order_new_a", status: "pending", created_at: minutesAgo(60) },
      { id: "order_canceled", status: "canceled", created_at: minutesAgo(60) },
      { id: "order_draft", status: "draft", created_at: minutesAgo(60) },
      { id: "order_failed", status: "pending", created_at: minutesAgo(60) },
      { id: "order_waiting", status: "pending", created_at: minutesAgo(60) },
      { id: "order_zk", status: "completed", created_at: minutesAgo(60) },
      { id: "order_fresh", status: "pending", created_at: minutesAgo(2) },
      { id: "order_new_a", status: "pending", created_at: minutesAgo(60) },
    ],
    [
      { order_id: "order_failed", status: "failed" },
      { order_id: "order_waiting", status: "waiting" },
    ],
    ["order_zk"],
    window,
  )
  assert.deepEqual(plan.queue, ["order_new_a", "order_new_b"])
  assert.deepEqual(plan.recheck, ["order_waiting"])
  assert.deepEqual(plan.skipped, { canceled: 1, draft: 1, has_task: 1, has_zk: 1, outside_window: 1 })
})

test("an order with a ZK and a waiting task is not rechecked", () => {
  const window = catchUpWindow(NOW, 10, 7, "2026-01-01T00:00:00.000Z")!
  const plan = planCatchUp([{ id: "o1", status: "pending", created_at: minutesAgo(60) }], [{ order_id: "o1", status: "waiting" }], ["o1"], window)
  assert.deepEqual([plan.queue, plan.recheck, plan.skipped.has_zk], [[], [], 1])
})

test("reconcile: missing, status differs, same and only local", () => {
  const entries = compareOrderDocuments(
    [
      { kind: "ZK", number: "ZK 12/MAG/2026", status: "open" },
      { kind: "WZ", number: "WZ 7/MAG/2026", status: "open" },
      { kind: "FS", number: "FS 3/2026", status: null },
    ],
    [
      { kind: "ZK", number: "ZK 12/MAG/2026", issued_at: "2026-11-01T10:00:00Z", status: "completed" },
      { kind: "WZ", number: "WZ 7/MAG/2026", issued_at: "2026-11-01T11:00:00Z" },
      { kind: "PA", number: "PA 9/2026", issued_at: "2026-11-01T12:00:00Z", status: "open", ksef_number: null },
      { kind: "PA", number: "PA 9/2026", issued_at: "2026-11-01T12:00:00Z", status: "open" },
    ],
  )
  assert.deepEqual(
    entries.map((e) => [e.number, e.state, e.remoteStatus, e.localStatus]),
    [
      ["ZK 12/MAG/2026", "status_differs", "completed", "open"],
      ["WZ 7/MAG/2026", "same", "open", "open"],
      ["PA 9/2026", "missing", "open", null],
      ["FS 3/2026", "only_local", null, "open"],
    ],
  )
  assert.deepEqual(entries.map(linkable), [true, false, true, false])
})

test("reconcile: a ZK only Subiekt has is missing, kind and spacing do not matter for matching", () => {
  const [entry] = compareOrderDocuments([], [{ kind: "ZK", number: "ZK 1/MAG/2026", issued_at: "2026-11-01T10:00:00Z" }])
  assert.equal(entry.state, "missing")
  assert.equal(entry.remoteStatus, "open")
  const same = compareOrderDocuments([{ kind: "zk", number: " ZK 1/MAG/2026 ", status: "open" }], [{ kind: "ZK", number: "ZK 1/MAG/2026", issued_at: "2026-11-01T10:00:00Z" }])
  assert.equal(same.length, 1)
  assert.equal(same[0].state, "same")
})

test("link: the document comes from the bridge answer, and settles only the task waiting for it", () => {
  const remote = [{ kind: "ZK", number: "ZK 1/MAG/2026", issued_at: "2026-11-01T10:00:00Z" }]
  assert.equal(findRemoteDocument(remote, "ZK", "ZK 1/MAG/2026")?.number, "ZK 1/MAG/2026")
  assert.equal(findRemoteDocument(remote, "ZK", "ZK 2/MAG/2026"), null)
  assert.equal(findRemoteDocument(remote, "FS", "ZK 1/MAG/2026"), null)

  assert.equal(taskSettledBy("ZK"), "order.create")
  assert.equal(taskSettledBy("fs"), "order.document")
  assert.equal(taskSettledBy("PA"), "order.document")
  assert.equal(taskSettledBy("WZ"), null)

  for (const s of ["waiting", "pending", "unknown", "failed"]) assert.equal(settleableStatus(s), true, s)
  for (const s of ["running", "succeeded", "canceled"]) assert.equal(settleableStatus(s), false, s)
})
