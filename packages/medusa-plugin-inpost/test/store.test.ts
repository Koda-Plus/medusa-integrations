/**
 * The SQL of the atomic store, checked as text with a recording runner: each
 * decision is one statement with the condition that makes it safe when two
 * processes race, and only known column names reach the SQL.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createSqlStore, PATCHABLE_COLUMNS, setClause, type SqlRunner } from "../src/modules/inpost/lib/store.ts"

function recorder(rows: unknown[] = [{ id: "inpar_1" }]) {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = []
  const sql: SqlRunner = {
    async raw(text, bindings = []) {
      calls.push({ sql: text.replace(/\s+/g, " ").trim(), bindings })
      return { rows }
    },
  }
  let n = 0
  return { calls, store: createSqlStore({ sql, newId: (p) => `${p}_${++n}` }) }
}

test("insert: one row per fulfillment and mode, the unique index decides (on conflict do nothing)", async () => {
  const { calls, store } = recorder()
  await store.insertIgnore({ order_id: "order_1", display_id: 1, fulfillment_id: "ful_1", demo: false, option_id: "inpost-paczkomat", kind: "locker", cod: false, service: "inpost_locker_standard", locker_code: "KSP01M", locker_name: null, locker_address: { line1: "x" }, parcel_size: null, parcel_no: 1, currency: "PLN", state: "pending" })
  assert.match(calls[0].sql, /^insert into "inpost_parcel" .* on conflict do nothing returning \*$/)
  assert.equal(calls[0].bindings[0], "inpar_1")
  assert.equal(calls[0].bindings[11], '{"line1":"x"}', "json columns go as JSON text")
})

test("claim: only from pending, one statement, with the token and the lease", async () => {
  const { calls, store } = recorder()
  const now = new Date("2026-10-07T12:00:00Z")
  await store.claim("inpar_1", { token: "t1", now, leaseUntil: new Date(now.getTime() + 120_000) })
  assert.match(calls[0].sql, /set "state" = 'creating', "claim_token" = \?/)
  assert.match(calls[0].sql, /where "id" = \? and "state" = 'pending' and "deleted_at" is null returning \*/)
  assert.deepEqual(calls[0].bindings.slice(0, 1), ["t1"])
})

test("finish: only the claim's owner writes the result, and the claim is cleared", async () => {
  const { calls, store } = recorder()
  await store.finish("inpar_1", "t1", { state: "created", shipment_id: "1001" })
  assert.match(calls[0].sql, /"claim_token" = null, "lease_until" = null where "id" = \? and "state" = 'creating' and "claim_token" = \?/)
  assert.deepEqual(calls[0].bindings.slice(-2), ["inpar_1", "t1"])
})

test("applyStatus: compare and set over the status the caller read; transitions only from given states", async () => {
  const { calls, store } = recorder()
  await store.applyStatus("inpar_1", "confirmed", { status: "collected_from_sender", tracking_number: "6".repeat(24), offer: null, at: new Date() })
  assert.match(calls[0].sql, /and coalesce\("status", ''\) = \? and coalesce\("status", ''\) <> \?/)
  assert.deepEqual(calls[0].bindings.slice(-3), ["inpar_1", "confirmed", "collected_from_sender"])
  await store.applyStatus("inpar_2", null, { status: "created", at: new Date() })
  assert.deepEqual(calls[1].bindings.slice(-2), ["", "created"], "no status yet is compared as the empty string")
  await store.transition("inpar_1", ["pending", "failed"], { state: "skipped" })
  assert.match(calls[2].sql, /and "state" in \(\?, \?\)/)
  assert.equal(await store.transition("inpar_1", [], { state: "x" }), null)
})

test("one purchase per ten minutes, one pickup per shipment, one mark per fulfillment", async () => {
  const { calls, store } = recorder()
  await store.claimBuy("inpar_1", new Date())
  assert.match(calls[0].sql, /"status" = 'offers_prepared'.*"buy_requested_at" is null or "buy_requested_at" < \?/)
  await store.claimDispatch(["inpar_1", "inpar_2"], new Date())
  assert.match(calls[1].sql, /"status" = 'confirmed' and \("dispatch_state" is null or "dispatch_state" = 'failed'\)/)
  await store.claimMark("inpar_1", "shipped_marked_at", new Date())
  assert.match(calls[2].sql, /"shipped_marked_at" is null/)
  assert.deepEqual(await store.claimDispatch([], new Date()), [])
})

test("events are ignored on a repeated dedupe key; settings are one row per key", async () => {
  const { calls, store } = recorder()
  await store.insertEvent({ parcel_id: null, order_id: null, shipment_id: "1", kind: "webhook", dedupe_key: "webhook:x", demo: false })
  assert.match(calls[0].sql, /insert into "inpost_parcel_event" .* on conflict do nothing returning \*/)
  await store.setSetting("live:writer:shipment", { on: true }, "user_1")
  assert.match(calls[1].sql, /on conflict \("key"\) do update set "value" = excluded."value"/)
  await store.claimSetting("demo:seeded", {})
  assert.match(calls[2].sql, /on conflict \("key"\) do nothing returning "id"/)
})

test("setClause: only known columns reach the SQL, JSON as jsonb, updated_at always", () => {
  const s = setClause({ state: "created", problems: [{ code: "x" }], ["dropped_table" as never]: "x" } as never)
  assert.equal(s.sql, `"state" = ?, "problems" = ?::jsonb, "updated_at" = now()`)
  assert.deepEqual(s.bindings, ["created", '[{"code":"x"}]'])
  assert.ok(PATCHABLE_COLUMNS.every((c) => /^[a-z_]+$/.test(c)))
})

test("expired claims become unknown, never pending: the shipment may exist", async () => {
  const { calls, store } = recorder()
  await store.expireLeases(new Date(), false)
  assert.match(calls[0].sql, /set "state" = 'unknown'.* where "state" = 'creating' and "lease_until" < \? and "demo" = \?/)
})
