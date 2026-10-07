/**
 * The outbox end to end: the real flows (enqueue, claim, build, look up,
 * create once, reconcile, payments, statuses, cancellations) against an
 * in-memory store with the rules of the SQL one, a fake Medusa container and
 * a scripted Fakturownia account. No network: `fetch` is replaced for the
 * duration of each test and refuses any other host.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { handleOrderCanceled } from "../src/workflows/fakturownia/cancel.ts"
import { ActionError, enqueueDue, issueAgain, issueDue, issueRow, markIssued, retryDocument } from "../src/workflows/fakturownia/documents.ts"
import { markPaidDue, requestMarkPaid } from "../src/workflows/fakturownia/payments.ts"
import { runningKinds } from "../src/workflows/fakturownia/runtime.ts"
import { refreshStatuses } from "../src/workflows/fakturownia/statuses.ts"
import { FakeFakturownia, LIVE, TOKEN, order, settle, setup, unpaid, type Row } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function live(fake: FakeFakturownia): void {
  globalThis.fetch = fake.fetch
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000)

function only(s: ReturnType<typeof setup>): Row {
  assert.equal(s.documents.rows.length, 1)
  return s.documents.rows[0]
}

test("one row per order and kind, whatever the number of events and racers", async () => {
  const s = setup(LIVE, [order()])
  live(new FakeFakturownia())
  await Promise.all([
    enqueueDue(s.container, order().id, "order_placed"),
    enqueueDue(s.container, order().id, "payment_captured"),
    enqueueDue(s.container, order().id, "payment_captured"),
  ])
  await enqueueDue(s.container, order().id, "payment_captured")
  const row = only(s)
  assert.deepEqual([row.kind, row.status, row.demo], ["vat", "pending", false])
})

test("nothing is queued before the trigger, and a canceled order gets nothing", async () => {
  const s = setup(LIVE, [unpaid(), order({ id: "order_canceled", status: "canceled" })])
  assert.equal((await enqueueDue(s.container, unpaid().id, "order_placed")).reason, "not_due")
  assert.equal((await enqueueDue(s.container, "order_canceled", "payment_captured")).reason, "order_canceled")
  assert.equal((await enqueueDue(s.container, "order_missing", "payment_captured")).reason, "order_not_found")
  assert.equal(s.documents.rows.length, 0)
  const notConfigured = setup({ demo: false }, [order()])
  assert.equal((await enqueueDue(notConfigured.container, order().id, "payment_captured")).reason, "not_configured")
})

test("live: look first, then ONE create with oid_unique; the row keeps the number and no buyer data", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  const stats = await issueDue(s.container, "schedule")
  assert.equal(stats?.issued, 1)
  assert.deepEqual(fake.methods(), ["GET /invoices.json", "POST /invoices.json"])
  const lookup = fake.calls[0].query
  assert.deepEqual([lookup.get("oid"), lookup.get("kind"), lookup.get("period")], ["1042", "vat", "more"])
  const sent = fake.calls[1].body.invoice
  assert.deepEqual([sent.kind, sent.oid, sent.oid_unique, sent.buyer_company, sent.paid], ["vat", "1042", "yes", false, "143.00"])
  for (const call of fake.calls) {
    assert.equal(call.authorization, `Bearer ${TOKEN}`)
    assert.ok(!call.url.includes("api_token"))
  }
  const row = only(s)
  assert.equal(row.status, "issued")
  assert.equal(row.number, "FV 1/10/2026")
  assert.equal(row.fakturownia_id, String(fake.docs[0].id))
  assert.equal(row.total_gross, 143)
  assert.equal(row.paid, true)
  assert.equal(row.gov_status, "processing")
  assert.equal(row.oid, "1042")
  assert.equal(row.positions.length, 2)
  const stored = JSON.stringify(row)
  for (const personal of ["Nowak", "Anna", "anna@example.com", "Długa", "00-001"]) assert.ok(!stored.includes(personal), personal)
  assert.ok(s.events.some((e) => e.name === "fakturownia.document_issued"))
  assert.ok(s.events.some((e) => e.name === "fakturownia.document.issued"))
  await issueDue(s.container, "schedule")
  assert.equal(fake.creating(), 1, "an issued row never goes out again")
})

test("live: an answer lost after Fakturownia committed: the second look adopts it, one create in total", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_after_commit"]
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.deepEqual([row.status, row.error_code, row.number], ["issued", "adopted", "FV 1/10/2026"])
  assert.equal(fake.creating(), 1)
  assert.deepEqual(fake.methods(), ["GET /invoices.json", "POST /invoices.json", "GET /invoices.json"])
})

test("live: a lost answer with nothing committed: unknown, no new create until the lookup says absent, then looked up and issued", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_no_commit", "ok"]
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.status, "unknown")
  assert.equal(row.error_code, "unknown_result")
  assert.ok(row.next_attempt_at.getTime() > Date.now() + 60_000, "reconciled only after the grace period")
  assert.equal(row.oid, "1042", "what was sent is on the row for the lookup")

  await issueDue(s.container, "schedule")
  assert.equal(fake.creating(), 1, "a pass inside the grace period sends nothing")

  /* The grace counts from the create request (create_sent_at), not from the claim. */
  row.claimed_at = ago(10)
  row.next_attempt_at = ago(1)
  await issueDue(s.container, "schedule")
  assert.equal(fake.creating(), 1, "a claim long ago does not shorten the grace of a request sent just now")
  row.create_sent_at = ago(10)
  row.next_attempt_at = ago(1)
  const before = fake.calls.length
  await issueDue(s.container, "schedule")
  assert.deepEqual(fake.methods().slice(before), ["GET /invoices.json", "GET /invoices.json", "POST /invoices.json"], "look (reconcile), look (attempt), then create")
  assert.equal(row.status, "issued")
  assert.equal(fake.creating(), 2)
  assert.equal(fake.docs.length, 1, "still one document in Fakturownia")
})

test("live: Fakturownia committed late: the reconciliation adopts instead of creating again", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_no_commit"]
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.status, "unknown")
  fake.add({ oid: "1042", kind: "vat", price_gross: "143.0", paid: "143.0", number: "FV 9/10/2026" })
  row.next_attempt_at = ago(1)
  await issueDue(s.container, "schedule")
  assert.deepEqual([row.status, row.number, row.error_code], ["issued", "FV 9/10/2026", "adopted"])
  assert.equal(fake.creating(), 1)
})

test("an expired claim (the process died mid-request) becomes unknown and is looked up before anything else", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  const row = only(s)
  Object.assign(row, { status: "issuing", claim_token: "dead-process", claimed_at: ago(30), lease_until: ago(20), attempts: 1, oid: "1042", total_gross: 143, currency: "PLN" })
  fake.add({ oid: "1042", kind: "vat", price_gross: "143.0" })
  const stats = await issueDue(s.container, "schedule")
  assert.equal(stats?.expired, 1)
  assert.equal(row.status, "issued")
  assert.equal(fake.creating(), 0)
})

test("two processes racing for one row: one claim, one create", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  const row = { ...only(s) }
  const outcomes = await Promise.all([issueRow(s.container, row as never), issueRow(s.container, row as never)])
  assert.deepEqual(outcomes.map((o) => o.status).sort(), ["busy", "issued"])
  assert.equal(fake.creating(), 1)
})

test("the same order number with another amount is a conflict: nothing is created, a person decides", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.add({ oid: "1042", kind: "vat", price_gross: "99.0", number: "FV 3/10/2026" })
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.deepEqual([row.status, row.error_code], ["failed", "conflict"])
  assert.match(row.error, /FV 3\/10\/2026/)
  assert.equal(fake.creating(), 0)
})

test("an older shop's document with the same number is ignored by the lookup, and oid_unique still refuses a duplicate", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.add({ oid: "1042", kind: "vat", price_gross: "99.0", issue_date: "2023-01-10", number: "FV 1/01/2023" })
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.status, "failed")
  assert.equal(row.error_code, "HTTP_422")
  assert.match(row.error, /oid/)
  assert.equal(fake.docs.length, 1, "Fakturownia refused the second document with that order number")
})

test("oidPrefix keeps Medusa numbers apart from an earlier shop's", async () => {
  const s = setup({ ...LIVE, oidPrefix: "M" }, [order()])
  const fake = new FakeFakturownia()
  fake.add({ oid: "1042", kind: "vat", price_gross: "99.0", issue_date: "2023-01-10" })
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  assert.equal(only(s).status, "issued")
  assert.equal(fake.calls.find((c) => c.method === "POST")?.body.invoice.oid, "M1042")
})

test("a refusal (422) fails at once with Fakturownia's reason; a 429 and a request that never left wait for the next attempt", async () => {
  for (const [mode, status, code] of [
    ["http_422", "failed", "HTTP_422"],
    ["http_429", "pending", "HTTP_429"],
    ["not_sent", "pending", "ERROR_NETWORK"],
  ] as const) {
    const s = setup(LIVE, [order()])
    const fake = new FakeFakturownia()
    fake.createModes = [mode]
    live(fake)
    await enqueueDue(s.container, order().id, "payment_captured")
    await issueDue(s.container, "schedule")
    const row = only(s)
    assert.deepEqual([row.status, row.error_code, row.attempts], [status, code, 1], mode)
    assert.equal(fake.creating(), 1)
    if (status === "pending") assert.ok(row.next_attempt_at.getTime() > Date.now(), "backoff")
    if (mode === "http_422") {
      assert.match(row.error, /buyer_tax_no/)
      assert.equal(s.events.at(-1)?.name, "fakturownia.document_failed")
    }
  }
})

test("a canceled order is never invoiced: the queued row is canceled, nothing is sent", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  s.orders.get(order().id)!.status = "canceled"
  await issueDue(s.container, "schedule")
  assert.deepEqual([only(s).status, only(s).error_code], ["canceled", "order_canceled"])
  assert.equal(fake.calls.length, 0)
})

test("receipts for consumers, VAT invoices for companies", async () => {
  const company = order({ id: "order_company", display_id: 2001, metadata: { nip: "1234563218" }, billing_address: { ...order().billing_address, company: "Firma sp. z o.o." } })
  const s = setup({ ...LIVE, receiptForConsumers: true, trigger: "order_placed" }, [unpaid(), company])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, unpaid().id, "order_placed")
  await enqueueDue(s.container, company.id, "order_placed")
  await issueDue(s.container, "schedule")
  const kinds = Object.fromEntries(s.documents.rows.map((r) => [r.order_id, r.kind]))
  assert.deepEqual(kinds, { [unpaid().id]: "receipt", order_company: "vat" })
  const posted = fake.calls.filter((c) => c.method === "POST").map((c) => [c.body.invoice.kind, c.body.invoice.buyer_company, c.body.invoice.buyer_tax_no])
  assert.deepEqual(posted, [
    ["receipt", false, undefined],
    ["vat", true, "1234563218"],
  ])
  const receipt = s.documents.rows.find((r) => r.kind === "receipt")!
  assert.equal(receipt.paid, false, "unpaid order: unpaid receipt with a term")
})

test("proforma flow: a proforma at capture, then the VAT invoice from it after the first fulfillment, linked, with the buyer type", async () => {
  const s = setup({ ...LIVE, documentFlow: "proforma_then_vat" }, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const proforma = only(s)
  assert.deepEqual([proforma.kind, proforma.status, proforma.number], ["proforma", "issued", "PRO 1/10/2026"])
  assert.equal(fake.calls.find((c) => c.method === "POST")?.body.invoice.oid_unique, "yes")

  assert.equal((await enqueueDue(s.container, order().id, "payment_captured")).inserted.length, 0, "nothing new before the fulfillment")
  s.orders.get(order().id)!.fulfillments = [{ id: "ful_1", canceled_at: null }]
  const queued = await enqueueDue(s.container, order().id, "fulfillment")
  assert.deepEqual(queued.inserted.map((r) => r.kind), ["vat"])

  const before = fake.calls.length
  await issueDue(s.container, "schedule")
  const calls = fake.calls.slice(before)
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [`GET /invoices/${proforma.fakturownia_id}.json`, "GET /invoices.json", "GET /invoices.json", "POST /invoices.json"],
  )
  assert.equal(calls[2].query.get("from_invoice_id"), proforma.fakturownia_id, "found also by the proforma it comes from")
  const vat = calls[3].body.invoice
  assert.equal(vat.kind, "vat")
  assert.equal(vat.from_invoice_id, Number(proforma.fakturownia_id))
  assert.deepEqual([vat.buyer_company, vat.buyer_first_name, vat.buyer_last_name], [false, "Anna", "Nowak"])
  assert.equal(vat.oid, "1042")
  assert.equal(vat.oid_unique, undefined)
  assert.ok(vat.positions.every((p: Row) => p.id === undefined && p.invoice_id === undefined))
  const final = s.documents.rows.find((r) => r.kind === "vat")!
  assert.deepEqual([final.status, final.from_fakturownia_id], ["issued", proforma.fakturownia_id])
})

test("proforma flow: the final document waits while the proforma is not issued, without using up an attempt", async () => {
  const s = setup({ ...LIVE, documentFlow: "proforma_then_vat" }, [order({ fulfillments: [{ id: "ful_1" }] })])
  const fake = new FakeFakturownia()
  live(fake)
  const pro = await s.store.insertIgnore({ order_id: order().id, display_id: 1042, kind: "proforma", demo: false, next_attempt_at: new Date(Date.now() + 3_600_000) })
  const vat = await s.store.insertIgnore({ order_id: order().id, display_id: 1042, kind: "vat", demo: false, next_attempt_at: new Date() })
  const out = await issueRow(s.container, vat!)
  assert.equal(out.status, "waiting")
  const row = s.documents.rows.find((r) => r.id === vat!.id)!
  assert.deepEqual([row.status, row.attempts, row.error_code], ["pending", 0, "waiting_for_proforma"])
  assert.equal(fake.calls.length, 0)
  assert.ok(pro)
})

test("cancel: an issued proforma is rejected in Fakturownia; a VAT invoice waits for a person's correction; a queued one is canceled", async () => {
  const p = setup({ ...LIVE, documentFlow: "proforma_then_vat" }, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(p.container, order().id, "payment_captured")
  await issueDue(p.container, "schedule")
  const stats = await handleOrderCanceled(p.container, order().id)
  assert.equal(stats.rejected, 1)
  const call = fake.calls.at(-1)!
  assert.equal(call.path, `/invoices/${only(p).fakturownia_id}/change_status.json`)
  assert.equal(call.query.get("status"), "rejected")
  assert.deepEqual([only(p).status, only(p).error_code], ["canceled", "proforma_rejected"])

  const v = setup(LIVE, [order(), order({ id: "order_2", display_id: 1043 })])
  const fake2 = new FakeFakturownia()
  live(fake2)
  await enqueueDue(v.container, order().id, "payment_captured")
  await enqueueDue(v.container, "order_2", "payment_captured")
  await issueRow(v.container, v.documents.rows[0] as never)
  const sent = fake2.calls.length
  await handleOrderCanceled(v.container, order().id)
  await handleOrderCanceled(v.container, "order_2")
  assert.equal(fake2.calls.length, sent, "an accounting document is never touched automatically")
  assert.deepEqual(
    v.documents.rows.map((r) => [r.order_id, r.status]),
    [
      [order().id, "needs_correction"],
      ["order_2", "canceled"],
    ],
  )
  assert.ok(v.events.some((e) => e.name === "fakturownia.document_needs_attention"))
})

test("payments: a capture marks an unpaid document paid in Fakturownia, after the amount check", async () => {
  const s = setup({ ...LIVE, trigger: "order_placed" }, [unpaid()])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, unpaid().id, "order_placed")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.paid, false)
  assert.equal(fake.calls.find((c) => c.method === "POST")?.body.invoice.payment_to_kind, 7)

  s.orders.get(unpaid().id)!.payment_collections = order().payment_collections
  assert.equal(await requestMarkPaid(s.container, unpaid().id), 1)
  const before = fake.calls.length
  const stats = await markPaidDue(s.container, "auto")
  assert.equal(stats?.marked, 1)
  const calls = fake.calls.slice(before)
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`GET /invoices/${row.fakturownia_id}.json`, `PUT /invoices/${row.fakturownia_id}.json`])
  assert.deepEqual(calls[1].body, { invoice: { paid: "143.00" } })
  assert.equal(row.paid, true)
  assert.equal(row.pay_requested_at, null)
})

test("payments: another amount in Fakturownia is not touched; a document paid there is only recorded", async () => {
  const s = setup({ ...LIVE, trigger: "order_placed" }, [unpaid(), unpaid({ id: "order_2", display_id: 1043 })])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, unpaid().id, "order_placed")
  await enqueueDue(s.container, "order_2", "order_placed")
  await issueDue(s.container, "schedule")
  for (const id of [unpaid().id, "order_2"]) s.orders.get(id)!.payment_collections = order().payment_collections
  fake.docs[0].price_gross = "150.0"
  fake.docs[1].paid = fake.docs[1].price_gross
  await requestMarkPaid(s.container, unpaid().id)
  await requestMarkPaid(s.container, "order_2")
  const stats = await markPaidDue(s.container, "auto")
  assert.deepEqual([stats?.mismatched, stats?.alreadyPaid, stats?.marked], [1, 1, 0])
  assert.equal(fake.calls.filter((c) => c.method === "PUT").length, 0)
  const [first, second] = s.documents.rows
  assert.deepEqual([first.paid, first.error_code], [false, "amount_mismatch"])
  assert.equal(second.paid, true)
})

test("KSeF: processing becomes accepted with its number; a document deleted in Fakturownia is reported", async () => {
  const s = setup(LIVE, [order(), order({ id: "order_2", display_id: 1043 })])
  const fake = new FakeFakturownia()
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await enqueueDue(s.container, "order_2", "payment_captured")
  await issueDue(s.container, "schedule")
  Object.assign(fake.docs[0], { gov_status: "ok", gov_id: "1234563218-20261005-ABC123DEF456" })
  fake.docs.splice(1, 1)
  const stats = await refreshStatuses(s.container, "manual")
  assert.deepEqual([stats?.accepted, stats?.missing], [1, 1])
  const [a, b] = s.documents.rows
  assert.deepEqual([a.gov_status, a.gov_id], ["ok", "1234563218-20261005-ABC123DEF456"])
  assert.equal(b.error_code, "remote_missing")
  const read = fake.calls.find((c) => c.method === "GET" && c.query.get("fields[invoice]"))
  assert.match(read?.query.get("fields[invoice]") ?? "", /gov_status/)
  const again = fake.calls.length
  await refreshStatuses(s.container, "manual")
  assert.equal(fake.calls.slice(again).filter((c) => c.path === `/invoices/${a.fakturownia_id}.json`).length, 0, "an accepted invoice is not read again")
})

test("e-mail: waits while KSeF has no number, then goes once", async () => {
  const s = setup({ ...LIVE, sendByEmail: true }, [order()])
  const fake = new FakeFakturownia()
  fake.emailMode = "ksef_wait"
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.email_status, "pending")
  assert.match(row.email_error, /KSeF/)
  fake.emailMode = "ok"
  await refreshStatuses(s.container, "manual")
  assert.equal(row.email_status, "sent")
  await refreshStatuses(s.container, "manual")
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, 2)
})

test("demo: nothing leaves Medusa; the backfill issues the newest orders, one refused; KSeF accepts later", async () => {
  const orders = Array.from({ length: 5 }, (_, i) =>
    order({ id: `order_demo_${i}`, display_id: 100 + i, created_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), total: 143 }),
  )
  const s = setup({ demo: true }, orders)
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  const { ensureDemoDocuments } = await import("../src/workflows/fakturownia/documents.ts")
  await ensureDemoDocuments(s.container)
  const rows = s.documents.rows
  assert.equal(rows.length, 5)
  assert.ok(rows.every((r) => r.demo === true))
  const failed = rows.filter((r) => r.status === "failed")
  assert.equal(failed.length, 1)
  assert.equal(failed[0].error_code, "HTTP_422")
  assert.match(failed[0].error, /Demo/)
  const issued = rows.filter((r) => r.status === "issued")
  assert.ok(issued.every((r) => /^FV \d+\/\d{2}\/\d{4}$/.test(r.number)))
  assert.equal(new Set(issued.map((r) => r.number)).size, 4)
  assert.ok(issued.every((r) => Number(r.fakturownia_id) > 700_000_000))
  assert.ok(issued.every((r) => r.gov_status === "processing"))
  await ensureDemoDocuments(s.container)
  assert.equal(s.documents.rows.length, 5, "the backfill runs once")
  for (const r of issued) r.issued_at = new Date(Date.now() - 9 * 60_000)
  await refreshStatuses(s.container, "manual")
  assert.ok(issued.every((r) => r.gov_status === "ok" && /^0000000000-/.test(r.gov_id)))
})

test("demo, proforma flow: fulfilled orders show the proforma and the VAT invoice made from it", async () => {
  const orders = [0, 1, 2].map((i) => order({ id: `order_p_${i}`, display_id: 200 + i, created_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), fulfillments: i === 0 ? [{ id: "f" }] : [] }))
  const s = setup({ demo: true, documentFlow: "proforma_then_vat" }, orders)
  const { ensureDemoDocuments } = await import("../src/workflows/fakturownia/documents.ts")
  await ensureDemoDocuments(s.container)
  const byOrder = s.documents.rows.filter((r) => r.order_id === "order_p_0")
  assert.deepEqual(byOrder.map((r) => r.kind).sort(), ["proforma", "vat"])
  const pro = byOrder.find((r) => r.kind === "proforma")!
  const vat = byOrder.find((r) => r.kind === "vat")!
  assert.match(pro.number, /^PRO /)
  assert.equal(vat.from_fakturownia_id, pro.fakturownia_id)
})

test("Mark as issued: the number must match the document Fakturownia holds", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_no_commit"]
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.status, "unknown")
  const remote = fake.add({ oid: "1042", kind: "vat", price_gross: "143.0", number: "FV 4/10/2026" })
  await assert.rejects(markIssued(s.container, row.id, { number: "FV 5/10/2026", fakturowniaId: String(remote.id) }), (e: unknown) => e instanceof ActionError && e.status === 409)
  await assert.rejects(markIssued(s.container, row.id, { number: "FV 4/10/2026", fakturowniaId: "999" }), (e: unknown) => e instanceof ActionError && e.status === 404)
  await assert.rejects(markIssued(s.container, row.id, { number: " " }), (e: unknown) => e instanceof ActionError && e.status === 400)
  const marked = await markIssued(s.container, row.id, { number: "FV 4/10/2026", fakturowniaId: String(remote.id) })
  assert.deepEqual([marked.status, marked.fakturownia_id, marked.error_code], ["issued", String(remote.id), "marked_by_person"])
  await assert.rejects(markIssued(s.container, row.id, { number: "FV 4/10/2026" }), (e: unknown) => e instanceof ActionError && e.status === 409, "only failed or unknown")
})

test("Retry moves only a failed row, Issue again only an unknown one", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["http_422", "ok"]
  live(fake)
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.status, "failed")
  assert.equal(await issueAgain(s.container, row.id), null)
  const moved = await retryDocument(s.container, row.id)
  assert.deepEqual([moved?.status, moved?.attempts], ["pending", 0])
  await settle(runningKinds)
  await issueDue(s.container, "schedule")
  assert.equal(row.status, "issued")
  assert.equal(fake.creating(), 2)
})

test("the token never reaches a stored error, a run or a log line", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  live(fake)
  const echo = fake.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("/invoices.json") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ code: "error", message: `Nieprawidłowy token ${TOKEN}` }), { status: 401 })
    }
    return echo(url, init)
  }) as typeof fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = only(s)
  assert.equal(row.status, "failed")
  const everything = JSON.stringify([row, s.runs.rows, s.logs, s.events])
  assert.ok(everything.includes("HTTP_401"))
  assert.ok(!everything.includes(TOKEN))
  assert.ok(!everything.includes("fkTEST0123456789abcdefGHIJ"))
})
