import { test } from "node:test"
import assert from "node:assert/strict"
import { CeneoBlockedError, CeneoClient, odataString, resetCeneoTokens, writerOfPath } from "../src/modules/ceneo/lib/ceneo-client.ts"
import { claimImport, ensureLeaseRow, finishImport, mergeWrites, recordDraft, releaseStale, resumeWrites, retryImport, takeRunLease, withRunLease, type SqlRunner } from "../src/modules/ceneo/lib/import-claim.ts"
import { demoWriteLog, demoWriteTransport, toCancelReasons, toCarriers, writeRequest } from "../src/modules/ceneo/lib/kup-teraz-write.ts"
import { demoOrders } from "../src/modules/ceneo/lib/demo-ceneo.ts"
import { resolveOptions } from "../src/modules/ceneo/lib/options.ts"
import { toCeneoOrderDto } from "../src/modules/ceneo/lib/order-dto.ts"
import {
  IMPORT_MAX_ATTEMPTS,
  afterWrite,
  afterWriteFailure,
  cancelDecision,
  importDecision,
  importStateOf,
  nextAttemptAt,
  nextWrite,
  postalCode,
  toMedusaOrder,
  trackingOf,
  writesPatch,
  type ImportRow,
} from "../src/modules/ceneo/lib/order-input.ts"
import { afterOutcome, armRefusal, outcomeOfStatus, togglePatch, writerState } from "../src/modules/ceneo/lib/writers.ts"

const GUID = "a68fad07-7402-49ed-a373-ac59881911aa"

function row(over: Partial<ImportRow> = {}): ImportRow {
  return {
    id: "cor_1",
    ceneo_order_id: GUID,
    displayed_order_id: "1234567ABC",
    state_id: 101,
    amounts: { order: 112.99, products: 100, delivery: 12.99 },
    delivery_form: "Kurier",
    payment_type_id: 1,
    items: [{ shop_product_id: "variant_1", name: "Kubek", price: 50, quantity: 2, total: 100, returned: 0, variant_id: "variant_1" }],
    matched: true,
    demo: false,
    medusa_order_id: null,
    import_status: null,
    import_attempts: 0,
    import_next_at: null,
    ceneo_writes: null,
    ...over,
  }
}

const DETAIL = {
  shipping: [{ Email: "marcin@example.com", PhoneNumber: "123123123", ShippingFirstName: "Marcin", ShippingLastName: "Nowak", ShippingCompanyName: "Ceneo", ShippingAddress: "Legnicka 48G", ShippingPostCode: "54‐202", ShippingCity: "Wrocław", ShippingRegion: "Dolnośląskie", ShippingCountry: "Polska" }],
  invoice: [{ InvoiceFirstName: "Marcin", InvoiceLastName: "Nowak", InvoiceCompanyName: "Ceneo SA", InvoiceNIP: "1234567890", InvoiceAddress: "Legnicka 48G", InvoicePostCode: "54202", InvoiceCity: "Wrocław", InvoiceCountry: "Polska", InvoiceProformaRequested: false }],
  pickup: [],
  services: [],
  remark: "Proszę dzwonić",
}

/* ---- options and writers ------------------------------------------------ */

test("options: writers are off live and on in demo, import states are the store's call", () => {
  const live = resolveOptions({ apiKey: "k" })
  assert.deepEqual(live.writes, { orders: false, status: false, bids: false, promo: false })
  assert.deepEqual(live.orders.importStates, [])
  assert.equal(live.orders.carrierId, null)
  const demo = resolveOptions({ demo: true })
  assert.deepEqual(demo.writes, { orders: true, status: true, bids: true, promo: true })
  assert.equal(demo.cpc.maxBid, 200)
  assert.equal(live.cpc.maxBid, null)
  assert.equal(resolveOptions({ cpc: { maxBid: "0,80", maxBidChangePercent: 0 } }).cpc.maxBid, 80)
  assert.equal(resolveOptions({ cpc: { maxBidChangePercent: 0 } }).cpc.maxBidChangePercent, 1)
  assert.deepEqual(demo.orders.importStates, [101, 102])
  const set = resolveOptions({ apiKey: "k", writes: { orders: "true" }, orders: { importStates: "5, 3,3, x", carrierId: "7", paidPaymentTypes: [1] } })
  assert.equal(set.writes.orders, true)
  assert.equal(set.writes.status, false)
  assert.deepEqual(set.orders.importStates, [3, 5])
  assert.equal(set.orders.carrierId, 7)
  assert.deepEqual(set.orders.paidPaymentTypes, [1])
})

test("writers: both switches, the mode, and the blockers", () => {
  const base = { key: "orders" as const, allowed: true, mode: "live" as const, hasKey: true, importStates: [3] }
  assert.equal(writerState({ ...base, row: { armed: true, mode: "live" } }).effective, true)
  assert.equal(writerState({ ...base, allowed: false, row: { armed: true, mode: "live" } }).effective, false)
  const demoArmed = writerState({ ...base, row: { armed: true, mode: "demo" } })
  assert.equal(demoArmed.effective, false)
  assert.equal(demoArmed.modeChanged, true)
  const noStates = writerState({ ...base, importStates: [], row: null })
  assert.deepEqual(noStates.blockers, ["no_import_states"])
  assert.match(armRefusal(noStates) ?? "", /importStates/)
  assert.equal(writerState({ ...base, key: "status", importStates: [], row: { armed: true, mode: "live" } }).effective, true)
  assert.match(armRefusal(writerState({ ...base, allowed: false, row: null })) ?? "", /writes\.orders/)
  assert.deepEqual(writerState({ ...base, key: "bids", maxBid: null, row: null }).blockers, ["no_max_bid"])
  assert.deepEqual(writerState({ ...base, key: "bids", maxBid: 80, row: null }).blockers, [])
  const patch = togglePatch(true, "live", { name: "Ala", id: "user_1" }, new Date(0))
  assert.equal(patch.changed_by, "Ala")
  assert.equal(patch.tripped_at, null)
})

test("circuit breaker: five systemic failures disarm, an order's own failure does not count", () => {
  const now = new Date(0)
  let r = { failure_streak: 0, armed: true }
  for (let i = 0; i < 4; i += 1) {
    const { patch, tripped } = afterOutcome(r, { kind: "systemic", message: "503" }, now)
    assert.equal(tripped, false)
    r = { ...r, failure_streak: patch.failure_streak ?? r.failure_streak }
  }
  assert.equal(afterOutcome(r, { kind: "item", message: "bad parcel" }, now).patch.failure_streak, undefined)
  const last = afterOutcome(r, { kind: "systemic", message: "503" }, now)
  assert.equal(last.tripped, true)
  assert.equal(last.patch.armed, false)
  assert.equal(afterOutcome(r, { kind: "ok" }, now).patch.failure_streak, 0)
  assert.equal(outcomeOfStatus(400, "x").kind, "item")
  assert.equal(outcomeOfStatus(401, "x").kind, "systemic")
  assert.equal(outcomeOfStatus(429, "x").kind, "systemic")
  assert.equal(outcomeOfStatus(null, "x").kind, "systemic")
})

/* ---- the barrier --------------------------------------------------------- */

function okFetch() {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    const body = url.includes("GetToken") ? '"tok-tok-tok-tok-tok"' : '{"d":{}}'
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body }
  }
  return { fn, calls }
}

test("barrier: a write path needs write() and an armed writer; reads never pass a write", async () => {
  resetCeneoTokens()
  const f = okFetch()
  const reader = new CeneoClient({ apiKey: "BA3A5A6F-1111", timeoutMs: 1000, fetch: f.fn })
  await assert.rejects(() => reader.get("/BasketService.svc/ConfirmOrder", { id: odataString(GUID) }), CeneoBlockedError)
  await assert.rejects(() => reader.write("/BasketService.svc/ConfirmOrder", { id: odataString(GUID) }, "status"), CeneoBlockedError)
  const writer = new CeneoClient({ apiKey: "BA3A5A6F-1111", timeoutMs: 1000, fetch: f.fn, writers: ["status"] })
  await assert.rejects(() => writer.write("/BasketService.svc/Orders", {}, "status"), CeneoBlockedError)
  await assert.rejects(() => writer.write("/BasketService.svc/ConfirmOrder", {}, "orders"), CeneoBlockedError)
  await writer.write("/BasketService.svc/ConfirmOrder", { id: odataString(GUID) }, "status")
  const sent = f.calls.find((u) => u.includes("ConfirmOrder")) ?? ""
  assert.match(sent, /ConfirmOrder\?id=%27a68fad07/)
  assert.equal(writerOfPath("/BasketService.svc/SetOrderShipment"), "status")
  assert.equal(writerOfPath("/BasketService.svc/Orders"), null)
  assert.equal(odataString("O'Neil"), "'O''Neil'")
})

test("barrier: a write is sent once, a 5xx is not repeated", async () => {
  resetCeneoTokens()
  let n = 0
  const fn = async (url: string) => {
    if (url.includes("GetToken")) return { ok: true, status: 200, headers: { get: () => null }, text: async () => '"tok-tok-tok-tok-tok"' }
    n += 1
    return { ok: false, status: 503, headers: { get: () => null }, text: async () => "busy" }
  }
  const c = new CeneoClient({ apiKey: "BA3A5A6F-2222", timeoutMs: 1000, fetch: fn, writers: ["status"], sleep: async () => undefined })
  await assert.rejects(() => c.write("/BasketService.svc/SendOrder", { id: odataString(GUID) }, "status"))
  assert.equal(n, 1)
})

test("write requests: the Swagger parameters", () => {
  const q = odataString
  assert.deepEqual(writeRequest(GUID, { kind: "confirm" }, q), { path: "/BasketService.svc/ConfirmOrder", query: { id: `'${GUID}'` } })
  assert.deepEqual(writeRequest(GUID, { kind: "shipment", tracking: "PL123", carrierId: 4 }, q).query, { orderId: `'${GUID}'`, trackingNumber: "'PL123'", carrierId: "4" })
  assert.deepEqual(writeRequest(GUID, { kind: "cancel", reason: "Brak" }, q).query, { id: `'${GUID}'`, reason: "'Brak'" })
  const set = writeRequest(GUID, { kind: "shop_order_id", shopOrderId: "1042" }, q)
  assert.equal(set.path, "/BasketService.svc/SetOrders")
  assert.deepEqual(JSON.parse(set.query.orders.slice(1, -1)), [{ OrderId: GUID, ShopOrderId: "1042" }])
  assert.deepEqual(toCarriers({ d: [{ Id: 2, Name: "B" }, { Id: 1, Name: "A" }] }), [{ id: 1, name: "A" }, { id: 2, name: "B" }])
  assert.deepEqual(toCancelReasons({ d: [{ Id: 1, Reason: "Towar niedostępny", RequiresDetailedText: false }] }), [{ id: 1, reason: "Towar niedostępny", requiresText: false }])
})

test("demo writes are recorded, never sent", async () => {
  const t = demoWriteTransport(() => 0)
  const before = demoWriteLog().length
  await t.run(GUID, { kind: "confirm" })
  assert.equal(demoWriteLog().length, before + 1)
  assert.equal(t.demo, true)
})

/* ---- the import ----------------------------------------------------------- */

test("import decision: mode, state, match, held and backoff", () => {
  const ctx = { demo: false, importStates: [101], now: 1_000_000 }
  assert.equal(importDecision(row(), ctx).kind, "import")
  assert.deepEqual(importDecision(row({ demo: true }), ctx), { kind: "skip", reason: "mode" })
  assert.deepEqual(importDecision(row({ state_id: 2 }), ctx), { kind: "skip", reason: "state" })
  assert.deepEqual(importDecision(row({ state_id: 999 }), ctx), { kind: "skip", reason: "state" })
  assert.deepEqual(importDecision(row({ matched: false }), ctx), { kind: "skip", reason: "unmatched" })
  assert.deepEqual(importDecision(row({ import_status: "held" }), ctx), { kind: "skip", reason: "held" })
  assert.deepEqual(importDecision(row({ import_status: "imported", medusa_order_id: "order_1" }), ctx), { kind: "skip", reason: "done" })
  assert.deepEqual(importDecision(row({ import_status: "failed", import_attempts: 1, import_next_at: new Date(2_000_000) }), ctx), { kind: "skip", reason: "backoff" })
  assert.deepEqual(importDecision(row({ import_status: "failed", import_attempts: IMPORT_MAX_ATTEMPTS }), ctx), { kind: "skip", reason: "exhausted" })
  /* A draft left by an earlier attempt is finished even when the state moved on. */
  assert.equal(importDecision(row({ import_status: "failed", import_attempts: 1, medusa_order_id: "order_1", state_id: 103 }), ctx).kind, "import")
  assert.equal(nextAttemptAt(1, 0)?.getTime(), 60_000)
  assert.equal(nextAttemptAt(IMPORT_MAX_ATTEMPTS, 0), null)
})

test("medusa order: addresses from Ceneo, Ceneo prices, no notification, marketplace ref", () => {
  const built = toMedusaOrder(row(), DETAIL, { regionId: "reg_1", salesChannelId: "sc_1", shippingOptionId: "so_1" })
  assert.equal(built.ok, true)
  if (!built.ok) return
  const o = built.order
  assert.equal(o.status, "draft")
  assert.equal(o.no_notification, true)
  assert.equal(o.currency_code, "pln")
  assert.deepEqual(o.shipping_address, { first_name: "Marcin", last_name: "Nowak", company: "Ceneo", address_1: "Legnicka 48G", city: "Wrocław", postal_code: "54-202", province: "Dolnośląskie", country_code: "pl", phone: "123123123" })
  assert.equal(o.billing_address.company, "Ceneo SA")
  assert.equal(o.billing_address.postal_code, "54-202")
  assert.deepEqual(o.items.map((i) => [i.variant_id, i.quantity, i.unit_price, i.is_tax_inclusive]), [["variant_1", 2, 50, true]])
  assert.deepEqual(o.shipping_methods[0], { name: "Kurier", amount: 12.99, is_tax_inclusive: true, shipping_option_id: "so_1", data: {} })
  assert.equal(o.metadata.marketplace_order_ref, `ceneo:${GUID}`)
  assert.equal(o.metadata.ceneo_invoice_nip, "1234567890")
  assert.equal(o.metadata.koda_demo, undefined)
  assert.equal(built.email, "marcin@example.com")
  assert.deepEqual(toMedusaOrder(row({ items: [] }), DETAIL, { regionId: "r", salesChannelId: "s", shippingOptionId: null }), { ok: false, problem: "no_items" })
  assert.deepEqual(toMedusaOrder(row(), { ...DETAIL, shipping: [] }, { regionId: "r", salesChannelId: "s", shippingOptionId: null }), { ok: false, problem: "no_address" })
  const locker = toMedusaOrder(row(), { ...DETAIL, shipping: [{ ShippingFirstName: "Jan", ShippingLastName: "K" }], pickup: [{ Name: "WRO01M", StreetAddress: "Legnicka 48G", City: "Wrocław", PostCode: "54-202" }] }, { regionId: "r", salesChannelId: "s", shippingOptionId: null })
  assert.equal(locker.ok && locker.order.shipping_address.address_1, "Legnicka 48G")
  assert.equal(locker.ok && locker.order.metadata.ceneo_pickup_point, "WRO01M")
  assert.equal(postalCode("54 202"), "54-202")
})

/* ---- writes and cancellations ------------------------------------------- */

test("next write: number, confirmation, parcel, sent; a cancellation wins", () => {
  const imported = row({ import_status: "imported", medusa_order_id: "order_1" })
  assert.deepEqual(nextWrite(row(), "1"), null)
  assert.deepEqual(nextWrite(imported, "1042"), { kind: "shop_order_id", shopOrderId: "1042" })
  let w = afterWrite(null, { kind: "shop_order_id", shopOrderId: "1042" }, "t1")
  assert.deepEqual(nextWrite({ ...imported, ceneo_writes: w }, "1042"), { kind: "confirm" })
  w = afterWrite(w, { kind: "confirm" }, "t2")
  assert.equal(nextWrite({ ...imported, ceneo_writes: w }, "1042"), null)
  w = { ...w, shipment: { tracking: "PL1", carrier_id: 3, queued_at: "t3" } }
  assert.deepEqual(nextWrite({ ...imported, ceneo_writes: w }, "1042"), { kind: "shipment", tracking: "PL1", carrierId: 3 })
  w = afterWrite(w, { kind: "shipment", tracking: "PL1", carrierId: 3 }, "t4")
  assert.deepEqual(nextWrite({ ...imported, ceneo_writes: w }, "1042"), { kind: "send" })
  w = afterWrite(w, { kind: "send" }, "t5")
  assert.equal(nextWrite({ ...imported, ceneo_writes: w }, "1042"), null)
  assert.deepEqual(nextWrite({ ...imported, ceneo_writes: { send_requested_at: "t", confirmed_at: "t", shop_order_id_at: "t" } }, "1"), { kind: "send" })
  assert.deepEqual(nextWrite({ ...imported, ceneo_writes: { cancel: { reason: "R", queued_at: "t" } } }, "1"), { kind: "cancel", reason: "R" })
  let failing = null as ReturnType<typeof afterWriteFailure> | null
  for (let i = 0; i < 5; i += 1) failing = afterWriteFailure(failing, "400", "t", true)
  assert.equal(nextWrite({ ...imported, ceneo_writes: failing }, "1"), null)
  assert.match(failing?.attention ?? "", /5 times/)
  assert.equal(afterWriteFailure(null, "503", "t", false).attempts, 0)
})

test("cancellation from Ceneo: cancels unless shipped, never on an unknown state", () => {
  assert.deepEqual(cancelDecision(103, [103], { status: "pending", fulfilled: false }), { kind: "cancel" })
  assert.equal(cancelDecision(103, [103], { status: "pending", fulfilled: true }).kind, "attention")
  assert.deepEqual(cancelDecision(103, [103], { status: "canceled", fulfilled: false }), { kind: "already" })
  assert.deepEqual(cancelDecision(77, [103], { status: "pending", fulfilled: false }), { kind: "none" })
  assert.deepEqual(cancelDecision(103, [], { status: "pending", fulfilled: false }), { kind: "none" })
  assert.equal(trackingOf([{ created_at: "2026-01-01", labels: [{ tracking_number: "OLD" }] }, { created_at: "2026-02-01", labels: [{ tracking_number: " NEW " }] }]), "NEW")
  assert.equal(trackingOf([{ labels: [] }]), null)
})

test("demo: some paid orders get cancelled later, so the cancellation path runs", () => {
  const offers = [{ offerId: "variant_a", title: "A", price: 10 }, { offerId: "variant_b", title: "B", price: 20 }]
  const all = demoOrders(offers, Date.UTC(2026, 10, 11, 18))
  assert.ok(all.some((o) => o.raw.OrderStateId === 103))
  assert.ok(all.some((o) => o.raw.OrderStateId === 101 || o.raw.OrderStateId === 102))
})

test("order dto: the import state for the admin", () => {
  assert.equal(importStateOf({ import_status: null, medusa_order_id: null, state_id: 101, matched: true }, [101]), "queued")
  assert.equal(importStateOf({ import_status: null, medusa_order_id: null, state_id: 1, matched: true }, [101]), "waiting_state")
  assert.equal(importStateOf({ import_status: null, medusa_order_id: null, state_id: 101, matched: false }, [101]), "waiting_match")
  assert.equal(importStateOf({ import_status: null, medusa_order_id: null, state_id: 101, matched: true }, []), "off")
  const dto = toCeneoOrderDto({ id: "cor_1", ceneo_order_id: GUID, import_status: "imported", medusa_order_id: "order_1", ceneo_writes: { confirmed_at: "t", cancel: { reason: "R", queued_at: "t" } } }, new Map(), [101])
  assert.equal(dto.importState, "imported")
  assert.equal(dto.writes.confirmedAt, "t")
  assert.equal(dto.writes.cancelQueued, true)
  assert.equal(toCeneoOrderDto({ id: "x", ceneo_order_id: GUID, import_status: "nonsense" }, new Map(), [101]).importState, "waiting_state")
})

/* ---- the claim, as SQL ---------------------------------------------------- */

function fakeSql(answer: (sql: string) => unknown[]): SqlRunner & { seen: Array<{ sql: string; bindings: readonly unknown[] }> } {
  const seen: Array<{ sql: string; bindings: readonly unknown[] }> = []
  return {
    seen,
    async raw(sql, bindings = []) {
      seen.push({ sql, bindings })
      return { rows: answer(sql) }
    },
  }
}

test("claim: one statement, guarded by status and token", async () => {
  const sql = fakeSql(() => [{ id: "cor_1" }])
  assert.equal(await claimImport(sql, "cor_1", { token: "t", leaseUntil: new Date(1), now: new Date(0), maxAttempts: 5 }), true)
  assert.match(sql.seen[0].sql, /"import_status" is null and "medusa_order_id" is null/)
  assert.match(sql.seen[0].sql, /returning "id"/)
  assert.equal(await finishImport(sql, "cor_1", "t", { status: "imported", importedAt: new Date(0) }), true)
  assert.match(sql.seen[1].sql, /"import_claim" = \?/)
  assert.deepEqual(sql.seen[1].bindings.slice(-2), ["cor_1", "t"])
  const lost = fakeSql(() => [])
  assert.equal(await claimImport(lost, "cor_1", { token: "t", leaseUntil: new Date(1), now: new Date(0), maxAttempts: 5 }), false)
  assert.equal(await retryImport(lost, "cor_1"), false)
  await releaseStale(sql, new Date(0))
  assert.match(sql.seen[2].sql, /when "medusa_order_id" is null then 'held'/)
  /* The draft id is saved whatever happened to the claim, never over another order. */
  await recordDraft(sql, "cor_1", "order_1")
  assert.match(sql.seen[3].sql, /"medusa_order_id" is null/)
  assert.doesNotMatch(sql.seen[3].sql, /import_claim/)
})

test("writes are merged in SQL, only the changed keys; a run lease holds across processes", async () => {
  const sql = fakeSql(() => [{ id: "orders" }])
  const before = { confirmed_at: "t1", shipment: { tracking: "PL1", carrier_id: 1, queued_at: "t2" } }
  const after = afterWrite(before, { kind: "shipment", tracking: "PL1", carrierId: 1 }, "t3")
  const patch = writesPatch(before, after)
  assert.deepEqual(Object.keys(patch).sort(), ["attempts", "shipment"])
  assert.equal("confirmed_at" in patch, false)
  await mergeWrites(sql, "cor_1", patch, { due: false, readAt: new Date(5) })
  assert.match(sql.seen[0].sql, /coalesce\("ceneo_writes", '\{\}'::jsonb\) \|\| \?::jsonb/)
  /* Off the queue only if nobody touched the row since the run read it (a cancellation meanwhile stays due). */
  assert.match(sql.seen[0].sql, /when date_trunc\('milliseconds', "updated_at"\) <= \? then false else "writes_due" end/)
  assert.equal(await takeRunLease(sql, "orders", "tok", new Date(1), new Date(0)), true)
  assert.match(sql.seen[1].sql, /"lease_until" is null or "lease_until" < \?/)
  await mergeWrites(sql, "cor_1", { cancel: { reason: "x", queued_at: "t" } }, { due: true })
  assert.match(sql.seen[2].sql, /"writes_due" = true/)
  /* A person resumes the writes: the note and the error go, the attempts restart, the order is due again. */
  await resumeWrites(sql, "cor_1", 5)
  assert.match(sql.seen[3].sql, /- 'attention' - 'error' - 'error_at'\) \|\| '\{"attempts":0\}'::jsonb/)
  assert.match(sql.seen[3].sql, /"writes_due" = true/)
})

test("the feed build holds a lease of its own: its row is created once, a held lease skips the run", async () => {
  const free = fakeSql((q) => (q.startsWith("update") && q.includes("lease_until") && !q.includes("= null") ? [{ id: "feed" }] : []))
  await ensureLeaseRow(free, "feed")
  assert.match(free.seen[0].sql, /insert into "ceneo_writer" \("id"\) values \(\?\) on conflict \("id"\) do nothing/)
  assert.equal(await withRunLease(free, "feed", 1000, async () => "built"), "built")
  /* Released after the run, by its own token only. */
  assert.match(free.seen.at(-1)?.sql ?? "", /"lease_token" = null.*"lease_token" = \?/s)
  const held = fakeSql(() => [])
  let ran = false
  assert.equal(await withRunLease(held, "feed", 1000, async () => (ran = true)), null)
  assert.equal(ran, false)
})
