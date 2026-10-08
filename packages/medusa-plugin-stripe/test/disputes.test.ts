import { test } from "node:test"
import assert from "node:assert/strict"
import { DashboardLinks } from "../src/modules/stripe/lib/dashboard.ts"
import { compareDisputes, disputeDeadline, isOpenDispute, needsResponse } from "../src/modules/stripe/lib/disputes.ts"
import { normalizeDispute, sortDisputes } from "../src/modules/stripe/lib/normalize.ts"
import type { DisputeRowDto } from "../src/modules/stripe/lib/contract.ts"
import { NOW, dispute, pi, sec } from "./fixtures.ts"

const HOUR = 3600

test("deadlines: days left, rounded up while time is left, coloured by urgency", () => {
  const due = (hours: number) => disputeDeadline({ status: "needs_response", dueBy: sec(NOW) + hours * HOUR, now: NOW })
  assert.deepEqual(due(30), { dueBy: new Date(NOW.getTime() + 30 * HOUR * 1000).toISOString(), daysLeft: 2, urgency: "urgent" })
  assert.equal(due(2).daysLeft, 1)
  assert.equal(due(2).urgency, "urgent")
  assert.equal(due(4 * 24).urgency, "soon")
  assert.equal(due(10 * 24).urgency, "ok")
  assert.equal(due(10 * 24).daysLeft, 10)
  const late = due(-30)
  assert.equal(late.urgency, "overdue")
  assert.equal(late.daysLeft, -2)
  assert.equal(disputeDeadline({ status: "needs_response", dueBy: sec(NOW) + 10 * 24 * HOUR, pastDue: true, now: NOW }).urgency, "overdue")
})

test("nothing to do while the bank reviews, after a decision, or without a deadline", () => {
  assert.equal(disputeDeadline({ status: "under_review", dueBy: sec(NOW) - HOUR, now: NOW }).urgency, "waiting")
  assert.equal(disputeDeadline({ status: "won", dueBy: null, now: NOW }).urgency, "waiting")
  assert.equal(disputeDeadline({ status: "needs_response", dueBy: null, now: NOW }).urgency, "waiting")
  assert.equal(disputeDeadline({ status: "warning_needs_response", dueBy: sec(NOW) + HOUR, now: NOW }).urgency, "urgent")
  assert.equal(isOpenDispute("under_review"), true)
  assert.equal(isOpenDispute("lost"), false)
  assert.equal(needsResponse("under_review"), false)
})

test("the most pressing first: overdue, then the closest deadline, then those under review", () => {
  const row = (urgency: DisputeRowDto["urgency"], dueBy: string | null, created: string) => ({ urgency, dueBy, created })
  const list = [
    row("waiting", null, "2026-10-01T00:00:00Z"),
    row("ok", "2026-10-20T00:00:00Z", "2026-10-02T00:00:00Z"),
    row("urgent", "2026-10-08T10:00:00Z", "2026-10-03T00:00:00Z"),
    row("urgent", "2026-10-08T08:00:00Z", "2026-10-03T00:00:00Z"),
    row("overdue", "2026-10-06T00:00:00Z", "2026-09-20T00:00:00Z"),
  ]
  assert.deepEqual(
    [...list].sort(compareDisputes).map((d) => `${d.urgency}:${d.dueBy ?? "-"}`),
    ["overdue:2026-10-06T00:00:00Z", "urgent:2026-10-08T08:00:00Z", "urgent:2026-10-08T10:00:00Z", "ok:2026-10-20T00:00:00Z", "waiting:-"],
  )
})

test("a dispute row carries its order, its method and its Dashboard link", () => {
  const payment = pi({ amount: 25_000, sessionId: "payses_order1", method: { type: "blik" } })
  const raw = dispute(payment, { dueInHours: 50, reason: "product_not_received", payment_method_details: { type: "blik" } })
  const ctx = { dashboard: new DashboardLinks("live"), orders: { orderOf: (s: string | null | undefined) => (s === "payses_order1" ? { id: "order_Fixture1", displayId: 1001 } : null) }, demo: false, now: new Date() }
  const row = normalizeDispute(raw, ctx)
  assert.ok(row)
  assert.equal(row.open, true)
  assert.equal(row.method, "blik")
  assert.equal(row.urgency, "urgent")
  assert.equal(row.daysLeft, 3)
  assert.deepEqual(row.order, { id: "order_Fixture1", displayId: 1001 })
  assert.equal(row.dashboardUrl, `https://dashboard.stripe.com/disputes/${raw.id}`)
  assert.equal(row.paymentIntent, payment.id)
  const fallback = normalizeDispute({ ...raw, payment_method_details: null }, { ...ctx, methodOf: () => "card" })
  assert.equal(fallback?.method, "card")
  const sorted = sortDisputes([normalizeDispute(dispute(payment, { status: "under_review" }), ctx)!, row])
  assert.equal(sorted[0].id, row.id)
})
