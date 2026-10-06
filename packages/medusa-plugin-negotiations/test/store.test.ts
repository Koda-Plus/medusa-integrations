import { test } from "node:test"
import assert from "node:assert/strict"
import { createDraftOrderStore, createSettingStore, createThreadStore, setClause, THREAD_PATCHABLE } from "../src/modules/negotiations/lib/store.ts"
import type { MessageInsert } from "../src/modules/negotiations/lib/rows.ts"

function recorder(rows: unknown[] = [{ id: "x" }]) {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = []
  let transactions = 0
  const sql = {
    async raw(text: string, bindings: readonly unknown[] = []) {
      calls.push({ sql: text.replace(/\s+/g, " ").trim(), bindings })
      return { rows }
    },
    async transaction<T>(fn: (trx: typeof sql) => Promise<T>): Promise<T> {
      transactions += 1
      return fn(sql)
    },
  }
  return { calls, sql, transactions: () => transactions }
}

const placeholders = (s: string) => (s.match(/\?/g) ?? []).length

const message: MessageInsert = {
  id: "negmsg_1",
  negotiation_id: "neg_1",
  author_type: "customer",
  author_id: "cus_1",
  kind: "message",
  body: "Hello",
  amount: 4690,
  internal: false,
  metadata: { text: { en: "Hello", pl: "Dzień dobry" } },
  created_at: new Date("2026-10-07T12:00:00Z"),
}

test("a move is ONE conditional update (status, mode, guards) and its message, in one transaction", async () => {
  const r = recorder([{ id: "neg_1", status: "accepted" }])
  const store = createThreadStore(r.sql)
  const now = new Date("2026-10-07T12:00:00Z")
  await store.act({
    id: "neg_1",
    demo: false,
    from: ["counter_offered"],
    guard: { offeredAmount: 49900 },
    patch: { status: "accepted", agreed_amount: 49900, price_amount: 49900, not_a_column: "x" } as never,
    countMessage: true,
    message,
    now,
  })
  assert.equal(r.transactions(), 1)
  const [update, insert] = r.calls
  assert.match(update.sql, /^update "negotiation" set "status" = \?, "agreed_amount" = \?, "price_amount" = \?, "message_count" = "message_count" \+ 1, "updated_at" = \?/)
  assert.match(update.sql, /where "id" = \? and "deleted_at" is null and "demo" = \? and "status" in \(\?\) and "offered_amount" = \? returning \*$/)
  assert.ok(!update.sql.includes("not_a_column"), "only whitelisted columns reach the SQL")
  assert.deepEqual(update.bindings, ["accepted", 49900, 49900, now, "neg_1", false, "counter_offered", 49900])
  assert.equal(placeholders(update.sql), update.bindings.length)
  assert.match(insert.sql, /^insert into "negotiation_message" \("id", "negotiation_id", "author_type", "author_id", "kind", "body", "amount", "internal", "metadata", "created_at", "updated_at"\) values \(.*\?::jsonb.*\) returning \*$/)
  assert.equal(placeholders(insert.sql), insert.bindings.length)
  assert.equal(insert.bindings[8], JSON.stringify(message.metadata))
})

test("a move that matches nothing writes no message", async () => {
  const r = recorder([])
  const store = createThreadStore(r.sql)
  const out = await store.act({ id: "neg_1", demo: true, from: ["open", "counter_offered"], patch: {}, countMessage: false, message, now: new Date() })
  assert.equal(out, null)
  assert.equal(r.calls.length, 1, "only the update ran")
  assert.match(r.calls[0].sql, /set "updated_at" = \? where/)
})

test("new threads: every column bound, jsonb cast for the cart lines and metadata", async () => {
  const r = recorder([{ id: "neg_1" }])
  const store = createThreadStore(r.sql)
  const at = new Date("2026-10-07T12:00:00Z")
  await store.insertThread(
    {
      id: "neg_1",
      ref: "NEG-2026-1001",
      status: "open",
      demo: false,
      source: "store",
      subject: "cart",
      customer_id: "cus_1",
      product_id: null,
      variant_id: null,
      cart_id: "cart_1",
      sku: null,
      title: null,
      qty: 1,
      currency_code: "pln",
      requested_amount: 100000,
      offered_amount: null,
      agreed_amount: null,
      price_amount: 100000,
      list_amount: 120000,
      items: [{ variant_id: "v", product_id: "p", sku: "A", title: "A", quantity: 2, unit_amount: 60000 }],
      waiting_for: "team",
      last_activity_at: at,
      message_count: 1,
      expires_at: null,
      closed_at: null,
      closed_by: null,
      assigned_to: null,
      metadata: null,
      created_at: at,
      updated_at: at,
    },
    message,
  )
  const [thread] = r.calls
  assert.equal(placeholders(thread.sql), thread.bindings.length)
  assert.equal(thread.bindings.length, 30)
  assert.ok(thread.sql.includes("?::jsonb"))
  assert.ok(thread.bindings.includes(JSON.stringify([{ variant_id: "v", product_id: "p", sku: "A", title: "A", quantity: 2, unit_amount: 60000 }])))
})

test("expiry: due rows locked with skip locked, their old status kept, closed in one statement", async () => {
  const r = recorder([{ id: "neg_1", status: "expired", previous_status: "counter_offered" }])
  const store = createThreadStore(r.sql)
  const now = new Date("2026-10-07T12:00:00Z")
  const cutoff = new Date("2026-09-23T12:00:00Z")
  const out = await store.expireDue({ demo: false, now, cutoff, limit: 500, message: () => message })
  const [update] = r.calls
  assert.match(update.sql, /^with "due" as \( select "id", "status" as "previous_status" from "negotiation"/)
  assert.match(update.sql, /\("expires_at" is not null and "expires_at" <= \?\) or \("expires_at" is null and coalesce\("last_activity_at", "updated_at"\) <= \?\)/)
  assert.match(update.sql, /limit \? for update skip locked \) update "negotiation" as "n" set "status" = 'expired'/)
  assert.match(update.sql, /returning "n"\.\*, "due"\."previous_status"$/)
  assert.deepEqual(update.bindings, [false, "open", "counter_offered", now, cutoff, 500, now, now])
  assert.equal(out[0].previousStatus, "counter_offered")
  assert.ok(!("previous_status" in out[0].thread), "the helper column does not leak into the row")
  const off = recorder([])
  await createThreadStore(off.sql).expireDue({ demo: false, now, cutoff: null, limit: 10, message: () => message })
  assert.ok(!off.calls[0].sql.includes("last_activity_at"), "no clock: only offers with their own validity")
})

test("lists: mode first, filters as bindings, the demo story left out for the store, search escaped by the caller", async () => {
  const r = recorder([])
  const store = createThreadStore(r.sql)
  await store.listThreads({
    demo: true,
    statuses: ["open"],
    waitingForTeam: true,
    customerId: "cus_1",
    product: { id: "prod_1", skus: ["A", "B"] },
    excludeDemoStory: true,
    search: { like: "%neg%", customerIds: ["cus_9"], productIds: [] },
    limit: 20,
    offset: 40,
  })
  const [list, count] = r.calls
  assert.match(list.sql, /^select \* from "negotiation" where "deleted_at" is null and "demo" = \? and "status" in \(\?\)/)
  assert.ok(list.sql.includes(`("product_id" = ? or ("product_id" is null and "sku" in (?, ?)))`))
  assert.ok(list.sql.includes(`left("id", 9) <> ?`))
  assert.ok(list.sql.includes(`("ref" ilike ? or "sku" ilike ? or "title" ilike ? or "customer_id" in (?))`))
  assert.match(list.sql, /order by coalesce\("last_activity_at", "updated_at"\) desc, "id" desc limit \? offset \?$/)
  assert.equal(placeholders(list.sql), list.bindings.length)
  assert.deepEqual(list.bindings.slice(-2), [20, 40])
  assert.match(count.sql, /^select count\(\*\)::int as "count" from "negotiation" where/)
})

test("the demo story is replaced under an advisory lock, and only its own rows", async () => {
  const r = recorder([])
  await createThreadStore(r.sql).replaceDemoStory([], [])
  assert.equal(r.transactions(), 1)
  assert.match(r.calls[0].sql, /pg_advisory_xact_lock/)
  assert.deepEqual(
    r.calls.slice(1).map((c) => [c.sql, c.bindings]),
    [
      [`delete from "negotiation_message" where left("negotiation_id", 9) = ?`, ["neg_demo_"]],
      [`delete from "negotiation_draft_order" where left("negotiation_id", 9) = ?`, ["neg_demo_"]],
      [`delete from "negotiation" where left("id", 9) = ?`, ["neg_demo_"]],
    ],
  )
})

test("settings are one row per key (upsert), runs keep the last N of their kind", async () => {
  const r = recorder([{ id: "negset_1", key: "live:writer:draftOrders" }])
  const settings = createSettingStore(r.sql, (p) => `${p}_1`)
  await settings.put("live:writer:draftOrders", { on: true }, "user_1", new Date())
  assert.match(r.calls[0].sql, /on conflict \("key"\) do update set "value" = excluded\."value"/)
  assert.equal(r.calls[0].bindings[2], JSON.stringify({ on: true }))
  await settings.recordRun(
    { id: "negrun_1", kind: "expire", trigger: "schedule", status: "ok", demo: false, counts: { expired: 2 }, message: null, started_at: new Date(), finished_at: new Date(), duration_ms: 5 },
    50,
  )
  assert.match(r.calls[2].sql, /delete from "negotiation_run" where "id" in \(select "id" from "negotiation_run" where "kind" = \? and "demo" = \? order by "started_at" desc offset \?\)/)
  assert.deepEqual(r.calls[2].bindings, ["expire", false, 50])
})

test("draft orders: one row per thread, a claim only from pending or failed, a result only for the claim's owner", async () => {
  const r = recorder([])
  const drafts = createDraftOrderStore(r.sql)
  const now = new Date()
  assert.equal(await drafts.queue({ id: "negdo_1", negotiation_id: "neg_1", demo: false, requested_by: null, now }), null)
  assert.match(r.calls[0].sql, /on conflict do nothing returning \*$/)
  await drafts.claim("negdo_1", { now, leaseUntil: now, token: "t1" })
  assert.match(r.calls[1].sql, /set "state" = 'creating', "claim_token" = \?.*where "id" = \? and "deleted_at" is null and "state" in \('pending', 'failed'\)/)
  assert.equal(await drafts.finish("negdo_1", "t1", { state: "created", draft_order_id: "order_1", payload: { a: 1 } }, now), false)
  assert.match(r.calls[2].sql, /"payload" = \?::jsonb.*"claim_token" = null.*where "id" = \? and "state" = 'creating' and "claim_token" = \? returning "id"$/)
  assert.equal(placeholders(r.calls[2].sql), r.calls[2].bindings.length)
  await drafts.expireLeases(now, false)
  assert.match(r.calls[3].sql, /set "state" = 'unknown'.*where "state" = 'creating' and "lease_until" < \? and "demo" = \?/)
  assert.equal(await drafts.transition("negdo_1", [], { state: "pending" }, now), null, "no state, no statement")
  assert.equal(r.calls.length, 4)
})

test("set clause: whitelisted columns, undefined skipped", () => {
  const set = setClause({ status: "open", requested_amount: undefined, waiting_for: null, hack: 1 }, THREAD_PATCHABLE)
  assert.equal(set.sql, `"status" = ?, "waiting_for" = ?`)
  assert.deepEqual(set.bindings, ["open", null])
})
