import { test } from "node:test"
import assert from "node:assert/strict"
import { dueAt, limitView, normalizeNetDays, remaining } from "../src/modules/credit/lib/credit.ts"

test("credit: the due date adds the terms, 0 means today", () => {
  const created = new Date("2026-01-10T10:00:00Z")
  assert.equal(dueAt(created, 30).toISOString(), "2026-02-09T23:59:59.999Z")
  assert.equal(dueAt(created, 0).toISOString(), "2026-01-10T23:59:59.999Z")
  assert.equal(dueAt(created, -5).toISOString(), "2026-01-10T23:59:59.999Z")
})

test("credit: the remaining amount never goes below zero", () => {
  assert.equal(remaining(1000, 400), 600)
  assert.equal(remaining(1000, 1200), 0)
})

test("credit: the limit view flags an exhausted limit", () => {
  const ok = limitView({ limit_amount: 1000, used_amount: 400, net_days: 30, status: "active", blocked: false })
  assert.equal(ok.remaining_amount, 600)
  assert.equal(ok.exhausted, false)
  const done = limitView({ limit_amount: 1000, used_amount: 1000, net_days: 30, status: "active", blocked: false })
  assert.equal(done.exhausted, true)
  assert.equal(limitView({ limit_amount: 0, used_amount: 0, net_days: 0, status: "active", blocked: false }).exhausted, false, "a zero limit reads no terms, not exhausted")
})

test("credit: the net days normalize into 0 to 365", () => {
  assert.equal(normalizeNetDays(30), 30)
  assert.equal(normalizeNetDays("14"), 14)
  assert.equal(normalizeNetDays(-3), 0)
  assert.equal(normalizeNetDays(999), 365)
  assert.equal(normalizeNetDays("soon"), 0)
})
