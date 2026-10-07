import { test } from "node:test"
import assert from "node:assert/strict"
import { DocumentConflictError, FakturowniaApiError, FakturowniaUnknownResultError, PayloadError } from "../src/modules/fakturownia/lib/errors.ts"
import { canIssueAgain, canMarkIssued, canReconcile, canRetry, isCertainlyAbsent, isSettled, planAfterFailure } from "../src/modules/fakturownia/lib/outbox.ts"
import { createSqlStore, setClause } from "../src/modules/fakturownia/lib/store.ts"
import { memoryStore, Table } from "./helpers.ts"

const now = new Date("2026-10-05T10:00:00Z")
const none = () => 0

test("after a lost answer: unknown, looked up after the grace period, never sent again blindly", () => {
  const plan = planAfterFailure(new FakturowniaUnknownResultError("create", "timeout"), { attempts: 1, now })
  assert.equal(plan.status, "unknown")
  assert.equal(plan.code, "unknown_result")
  assert.deepEqual(plan.nextAttemptAt, new Date("2026-10-05T10:02:00Z"))
})

test("after a refusal that may pass (429, not sent, a lookup that failed before the create): retried with backoff", () => {
  for (const err of [
    new FakturowniaApiError({ code: "HTTP_429", operation: "create", message: "", transient: true, refused: true }),
    new FakturowniaApiError({ code: "ERROR_NETWORK", operation: "create", message: "", transient: true, refused: true }),
    new FakturowniaApiError({ code: "HTTP_503", operation: "list", message: "", transient: true }),
  ]) {
    const plan = planAfterFailure(err, { attempts: 1, now, random: none })
    assert.equal(plan.status, "pending", err.code)
    assert.deepEqual(plan.nextAttemptAt, new Date("2026-10-05T10:01:00Z"))
  }
  assert.equal(planAfterFailure(new Error("database hiccup"), { attempts: 1, now, random: none }).status, "pending", "our own glitches retry too")
})

test("after a permanent refusal, bad order data or a conflict: failed, for a person", () => {
  for (const err of [
    new FakturowniaApiError({ code: "HTTP_422", operation: "create", message: "buyer_tax_no", transient: false, refused: true }),
    new FakturowniaApiError({ code: "HTTP_401", operation: "list", message: "token", transient: false, refused: true }),
    new PayloadError("no_quantity", "no quantity"),
    new DocumentConflictError({ remoteId: "1", remoteNumber: "FV 1/10/2026", message: "another amount" }),
  ]) {
    const plan = planAfterFailure(err, { attempts: 1, now })
    assert.equal(plan.status, "failed")
    assert.equal(plan.nextAttemptAt, null)
  }
  assert.equal(planAfterFailure(new FakturowniaApiError({ code: "HTTP_429", operation: "create", message: "", transient: true, refused: true }), { attempts: 14, now }).status, "failed", "attempts used up")
})

test("what a person may do, by state", () => {
  assert.deepEqual([canRetry("failed"), canRetry("unknown"), canRetry("issued")], [true, false, false])
  assert.deepEqual([canReconcile("unknown"), canIssueAgain("unknown"), canIssueAgain("failed")], [true, true, false])
  assert.deepEqual([canMarkIssued("unknown"), canMarkIssued("failed"), canMarkIssued("issued"), canMarkIssued("pending")], [true, true, false, false])
  assert.deepEqual(["issued", "canceled", "needs_correction", "pending", "unknown"].map(isSettled), [true, true, true, false, false])
  assert.deepEqual(["pending", "failed", "unknown", "issuing"].map(isCertainlyAbsent), [true, true, false, false])
})

/* ---- The SQL statements: the atomic conditions are in the SQL itself ---- */

function recorder(rows: unknown[] = [{ id: "fkdoc_1" }]) {
  const seen: Array<{ sql: string; bindings: readonly unknown[] }> = []
  const sql = {
    raw: async (text: string, bindings: readonly unknown[] = []) => {
      seen.push({ sql: text.replace(/\s+/g, " ").trim(), bindings })
      return { rows }
    },
  }
  return { seen, store: createSqlStore({ sql, newId: () => "fkdoc_new" }) }
}

test("SQL: the insert is ignored on a unique conflict (both indexes), never an update", async () => {
  const { seen, store } = recorder([])
  const row = await store.insertIgnore({ order_id: "order_1", display_id: 1042, kind: "vat", demo: false, next_attempt_at: now })
  assert.equal(row, null)
  assert.match(seen[0].sql, /^insert into "fakturownia_document" .* on conflict do nothing returning \*$/)
  assert.deepEqual(seen[0].bindings.slice(0, 5), ["fkdoc_new", "order_1", 1042, "vat", false])
})

test("SQL: the claim is one conditional UPDATE: only a pending, due row, with a token and a lease", async () => {
  const { seen, store } = recorder()
  await store.claim("fkdoc_1", { now, leaseUntil: new Date(now.getTime() + 600_000), token: "tok-1" })
  const s = seen[0].sql
  assert.match(s, /^update "fakturownia_document" set "status" = 'issuing', "claim_token" = \?, "claimed_at" = \?, "lease_until" = \?, "create_sent_at" = null, "attempts" = "attempts" \+ 1/)
  assert.match(s, /where "id" = \? and "status" = 'pending' and "deleted_at" is null and \("next_attempt_at" is null or "next_attempt_at" <= \?\) returning \*$/)
  assert.deepEqual(seen[0].bindings, ["tok-1", now, new Date(now.getTime() + 600_000), "fkdoc_1", now])
})

test("SQL: the result is written only by the claim's owner; transitions only from the given states", async () => {
  const { seen, store } = recorder()
  assert.equal(await store.finish("fkdoc_1", "tok-1", { status: "issued", number: "FV 1/10/2026", positions: [{ name: "A" }] as never }), true)
  assert.match(seen[0].sql, /set "status" = \?, "number" = \?, "positions" = \?::jsonb, "updated_at" = now\(\), "claim_token" = null, "lease_until" = null where "id" = \? and "status" = 'issuing' and "claim_token" = \?/)
  assert.deepEqual(seen[0].bindings, ["issued", "FV 1/10/2026", '[{"name":"A"}]', "fkdoc_1", "tok-1"])
  await store.transition("fkdoc_1", ["failed", "unknown"], { status: "pending" })
  assert.match(seen[1].sql, /where "id" = \? and "status" in \(\?, \?\) and "deleted_at" is null returning \*$/)
  assert.deepEqual(seen[1].bindings, ["pending", "fkdoc_1", "failed", "unknown"])
  await store.expireLeases(now, false)
  assert.match(seen[2].sql, /set "status" = 'unknown'.* where "status" = 'issuing' and "lease_until" < \? and "demo" = \?/)
})

test("SQL: a patch reaches the statement only through the column allowlist", () => {
  const set = setClause({ status: "issued", evil: "x", claim_token: "y", id: "z" } as never)
  assert.equal(set.sql, '"status" = ?, "updated_at" = now()')
  assert.deepEqual(set.bindings, ["issued"])
})

/* ---- The same rules in the memory store the flow tests use ---- */

test("one row per order and kind, one final document per order, two claims and only one wins", async () => {
  const table = new Table("fkdoc")
  const store = memoryStore(table)
  const vat = await store.insertIgnore({ order_id: "o1", display_id: 1, kind: "vat", demo: false, next_attempt_at: now })
  assert.ok(vat)
  assert.equal(await store.insertIgnore({ order_id: "o1", display_id: 1, kind: "vat", demo: false, next_attempt_at: now }), null)
  assert.equal(await store.insertIgnore({ order_id: "o1", display_id: 1, kind: "receipt", demo: false, next_attempt_at: now }), null, "never a VAT invoice and a receipt")
  assert.ok(await store.insertIgnore({ order_id: "o1", display_id: 1, kind: "proforma", demo: false, next_attempt_at: now }))
  assert.ok(await store.insertIgnore({ order_id: "o1", display_id: 1, kind: "vat", demo: true, next_attempt_at: now }), "demo rows live apart")
  const [a, b] = await Promise.all([
    store.claim(vat!.id, { now, leaseUntil: now, token: "a" }),
    store.claim(vat!.id, { now, leaseUntil: now, token: "b" }),
  ])
  assert.deepEqual([Boolean(a), Boolean(b)], [true, false])
  assert.equal(await store.finish(vat!.id, "b", { status: "issued" }), false, "not the owner")
  assert.equal(await store.finish(vat!.id, "a", { status: "issued" }), true)
})
