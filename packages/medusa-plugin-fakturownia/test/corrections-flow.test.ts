/**
 * Corrections end to end: a change of an issued order, the plan, a person's
 * approval of the revision they saw, the writer's two switches, the
 * correction issued exactly once (also after a lost answer), the corrected
 * document settling, and the cases the plugin leaves to a person.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { approvePlan, dismissPlan, markPlanDone, planCorrections, scanCorrections } from "../src/workflows/fakturownia/corrections.ts"
import { onOrderCanceled, onPaymentRefunded, onReturnReceived } from "../src/workflows/fakturownia/events.ts"
import { ActionError, runningKinds } from "../src/workflows/fakturownia/runtime.ts"
import { writerSettingKey, writerState } from "../src/modules/fakturownia/lib/writers.ts"
import { resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { FakeFakturownia, LIVE, order, settle, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const ORDER_ID = order().id

/** An issued VAT invoice for `order()` in a live setup. */
async function issued(options = LIVE, over: Row = {}): Promise<{ s: Setup; fake: FakeFakturownia; original: Row }> {
  const s = setup(options, [order(over)])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, ORDER_ID, "payment_captured")
  await issueDue(s.container, "schedule")
  const original = s.documents.rows.find((r) => r.kind !== "correction")!
  assert.equal(original.status, "issued")
  return { s, fake, original }
}

function returnOne(s: Setup): void {
  const o = s.orders.get(ORDER_ID)!
  o.items[0].detail = { quantity: 2, return_received_quantity: 1 }
}

async function arm(s: Setup, demo = false): Promise<void> {
  await s.planStore.setSetting(writerSettingKey("corrections", demo), { on: true }, "user_1")
}

const corrections = (s: Setup) => s.documents.rows.filter((r) => r.kind === "correction")

test("a return: a draft plan; the approval of the seen revision queues the correction; it waits for the writer", async () => {
  const { s, fake, original } = await issued()
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  assert.equal(s.plans.rows.length, 1)
  const plan = s.plans.rows[0]
  assert.deepEqual([plan.status, plan.revision, plan.delta_gross, plan.document_id], ["draft", 1, -61.5, original.id])
  assert.deepEqual(plan.sources.map((x: Row) => `${x.type}:${x.id}`), ["return:return_1"])

  await assert.rejects(approvePlan(s.container, plan.id, { revision: 2, actorId: "user_1" }), (e: unknown) => e instanceof ActionError && e.status === 409)
  const r = await approvePlan(s.container, plan.id, { revision: 1, reason: "", actorId: "user_1" })
  assert.equal(r.armed, false)
  assert.deepEqual([r.plan.status, r.plan.approved_by, r.plan.source_key], ["approved", "user_1", "return:return_1"])
  assert.match(r.plan.reason ?? "", /^Zwrot towaru \(zamówienie 1042\)$/)
  const [row] = corrections(s)
  assert.deepEqual([row.status, row.source_key, row.corrects_document_id, row.plan_id, row.total_gross], ["pending", "return:return_1", original.id, plan.id, -61.5])
  await assert.rejects(approvePlan(s.container, plan.id, { revision: 1, actorId: "user_2" }), (e: unknown) => e instanceof ActionError && e.status === 409, "decided once")

  const creates = fake.creating()
  await issueDue(s.container, "schedule")
  assert.equal(fake.creating(), creates, "the writer is off: nothing is sent")
  assert.equal(row.status, "pending")
})

test("the armed writer issues the correction once, as documented, and other plugins hear of it once", async () => {
  const { s, fake, original } = await issued()
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  await arm(s)
  const before = fake.calls.length
  await issueDue(s.container, "schedule")
  const calls = fake.calls.slice(before)
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [`GET /invoices/${original.fakturownia_id}.json`, "GET /invoices.json", "GET /invoices.json", "POST /invoices.json"],
  )
  assert.equal(calls[1].query.get("from_invoice_id"), original.fakturownia_id)
  assert.deepEqual([calls[2].query.get("oid"), calls[2].query.get("kind")], ["1042", "correction"])
  const sent = calls[3].body.invoice
  assert.deepEqual([sent.kind, sent.invoice_id, sent.from_invoice_id, sent.oid_unique], ["correction", Number(original.fakturownia_id), Number(original.fakturownia_id), undefined])
  assert.deepEqual([sent.buyer_company, sent.buyer_first_name, sent.oid], [false, "Anna", "1042"], "the buyer as Fakturownia holds it")
  assert.deepEqual([sent.positions[0].kind, sent.positions[0].quantity, sent.positions[0].total_price_gross], ["correction", -1, -61.5])
  const [row] = corrections(s)
  assert.deepEqual([row.status, row.number, row.from_fakturownia_id], ["issued", "KOR 1/10/2026", original.fakturownia_id])
  assert.equal(s.plans.rows[0].status, "issued")
  const corrected = s.events.filter((e) => e.name === "fakturownia.document.corrected")
  assert.equal(corrected.length, 1)
  assert.deepEqual(corrected[0].data, { id: row.id, order_id: ORDER_ID, kind: "correction", number: "KOR 1/10/2026", external_id: row.fakturownia_id, demo: false })
  assert.equal(s.events.filter((e) => e.name === "fakturownia.document.issued").length, 1, "only the VAT invoice")

  await issueDue(s.container, "schedule")
  await planCorrections(s.container, ORDER_ID, null)
  assert.equal(fake.creating(), 2, "the VAT invoice and one correction, never more")
  assert.equal(s.plans.rows.length, 1, "the issued correction is not planned again")
})

test("a lost answer to the correction create: the second look finds it by its marker", async () => {
  const { s, fake } = await issued()
  fake.createModes = ["lost_after_commit"]
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  await arm(s)
  await issueDue(s.container, "schedule")
  const [row] = corrections(s)
  assert.deepEqual([row.status, row.error_code], ["issued", "adopted"])
  assert.equal(fake.creating(), 2)
  assert.equal(fake.docs.filter((d) => d.kind === "correction").length, 1)
})

test("an unknown correction is reconciled before anything is sent again", async () => {
  const { s, fake } = await issued()
  fake.createModes = ["lost_no_commit"]
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  await arm(s)
  await issueDue(s.container, "schedule")
  const [row] = corrections(s)
  assert.equal(row.status, "unknown")
  const original = s.documents.rows.find((r) => r.kind === "vat")!
  fake.add({ kind: "correction", oid: "1042", from_invoice_id: Number(original.fakturownia_id), invoice_id: Number(original.fakturownia_id), price_gross: "-61.5", internal_note: `Medusa #1042 [medusa:${row.id}]`, number: "KOR 7/10/2026" })
  row.next_attempt_at = new Date(Date.now() - 60_000)
  await issueDue(s.container, "schedule")
  assert.deepEqual([row.status, row.number], ["issued", "KOR 7/10/2026"])
  assert.equal(fake.creating(), 2, "one create for the VAT invoice, one lost one for the correction")
  assert.equal(s.plans.rows[0].status, "issued")
})

test("a canceled order: the invoice is flagged and corrected to zero; once corrected it is issued again", async () => {
  const { s, original } = await issued()
  s.orders.get(ORDER_ID)!.status = "canceled"
  await onOrderCanceled(s.container, ORDER_ID)
  assert.equal(original.status, "needs_correction")
  const plan = s.plans.rows[0]
  assert.deepEqual([plan.status, plan.delta_gross, plan.reasons], ["draft", -143, ["cancel"]])
  await approvePlan(s.container, plan.id, { revision: 1, actorId: "user_1" })
  await arm(s)
  await issueDue(s.container, "schedule")
  const [row] = corrections(s)
  assert.equal(row.status, "issued", "a correction is not canceled with its order")
  assert.deepEqual([original.status, original.error_code], ["issued", "corrected"])
})

test("a dismissed plan counts as decided: the same change is not planned again", async () => {
  const { s } = await issued()
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  const plan = s.plans.rows[0]
  const dismissed = await dismissPlan(s.container, plan.id, { note: "Corrected by hand", actorId: "user_1" })
  assert.deepEqual([dismissed.status, dismissed.closed_by, dismissed.close_note], ["dismissed", "user_1", "Corrected by hand"])
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  await planCorrections(s.container, ORDER_ID, null, { force: true })
  assert.equal(s.plans.rows.length, 1)
  await assert.rejects(dismissPlan(s.container, plan.id, { actorId: null }), (e: unknown) => e instanceof ActionError && e.status === 409)
})

test("an approved plan is dismissed only while its correction certainly does not exist", async () => {
  const { s, fake } = await issued()
  fake.createModes = ["lost_no_commit"]
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  const plan = s.plans.rows[0]
  await approvePlan(s.container, plan.id, { revision: 1, actorId: "user_1" })
  await arm(s)
  await issueDue(s.container, "schedule")
  assert.equal(corrections(s)[0].status, "unknown")
  await assert.rejects(dismissPlan(s.container, plan.id, { actorId: "user_1" }), (e: unknown) => e instanceof ActionError && e.status === 409, "unknown may exist")
})

test("a draft follows the order until it is decided, and closes when nothing is left to correct", async () => {
  const { s } = await issued()
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  const plan = s.plans.rows[0]
  s.orders.get(ORDER_ID)!.items[0].detail = { quantity: 2, return_received_quantity: 2 }
  await onReturnReceived(s.container, ORDER_ID, "return_2")
  assert.deepEqual([plan.revision, plan.delta_gross], [2, -123])
  assert.deepEqual(plan.sources.map((x: Row) => x.id), ["return_1", "return_2"])
  s.orders.get(ORDER_ID)!.items[0].detail = { quantity: 2 }
  await planCorrections(s.container, ORDER_ID, null, { force: true })
  assert.equal(plan.status, "obsolete")
})

test("a refund event plans a price reduction for the order of the payment", async () => {
  const { s } = await issued()
  const o = s.orders.get(ORDER_ID)!
  o.payment_collections[0].payments[0].refunds = [{ id: "ref_1", amount: 14.3, created_at: new Date().toISOString() }]
  s.payments.set("pay_1", { id: "pay_1", payment_collection_id: "paycol_1", refunds: [{ id: "ref_1", created_at: new Date().toISOString() }] })
  s.collections.set("paycol_1", { id: "paycol_1", order: { id: ORDER_ID } })
  await onPaymentRefunded(s.container, "pay_1")
  const plan = s.plans.rows[0]
  assert.deepEqual([plan.status, plan.delta_gross, plan.reasons], ["draft", -14.3, ["refund"]])
  assert.deepEqual(plan.sources.map((x: Row) => `${x.type}:${x.id}`), ["refund:ref_1"])
})

test("receipts: the plan is manual (the register of returns), never sent; a person marks it done", async () => {
  const { s, fake } = await issued({ ...LIVE, receiptForConsumers: true })
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  const plan = s.plans.rows[0]
  assert.deepEqual([plan.status, plan.manual_reason, plan.delta_gross], ["manual", "receipt", -61.5])
  await assert.rejects(approvePlan(s.container, plan.id, { revision: 1, actorId: "user_1" }), (e: unknown) => e instanceof ActionError && e.status === 409)
  const done = await markPlanDone(s.container, plan.id, { note: "Ewidencja zwrotów, poz. 12", actorId: "user_1" })
  assert.equal(done.status, "done")
  await arm(s)
  await issueDue(s.container, "schedule")
  assert.equal(fake.creating(), 1, "only the receipt itself")
})

test("claims and exchanges are left to a person", async () => {
  const { s } = await issued()
  returnOne(s)
  s.claims.set(ORDER_ID, [{ id: "claim_1", type: "exchange", canceled_at: null }])
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  assert.deepEqual([s.plans.rows[0].status, s.plans.rows[0].manual_reason], ["manual", "claim_or_exchange"])
})

test("an invoice edited in Fakturownia after issue: the correction is not sent", async () => {
  const { s, fake } = await issued()
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  fake.docs[0].positions[0].quantity = "3.0"
  await arm(s)
  await issueDue(s.container, "schedule")
  const [row] = corrections(s)
  assert.deepEqual([row.status, row.error_code], ["failed", "original_changed"])
  assert.match(row.error, /Nothing was sent/)
  assert.equal(fake.creating(), 1)
})

test("corrections off: no plans, the canceled order's invoice is only flagged (0.1.0)", async () => {
  const { s, original } = await issued({ ...LIVE, corrections: "off" })
  s.orders.get(ORDER_ID)!.status = "canceled"
  await onOrderCanceled(s.container, ORDER_ID)
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  assert.equal(s.plans.rows.length, 0)
  assert.equal(original.status, "needs_correction")
})

test("the scan plans what the events missed, and repairs an approval without its correction row", async () => {
  const { s } = await issued()
  returnOne(s)
  const stats = await scanCorrections(s.container, "manual")
  assert.deepEqual([stats?.checked, stats?.created], [1, 1])
  const plan = s.plans.rows[0]
  await s.planStore.approve(plan.id, { revision: 1, approvedBy: "user_1", reason: "Zwrot", sourceKey: `plan:${plan.id}`, now: new Date() })
  assert.equal(corrections(s).length, 0)
  const again = await scanCorrections(s.container, "manual")
  assert.equal(again?.repaired, 1)
  assert.equal(corrections(s)[0].source_key, `plan:${plan.id}`)
  assert.equal(s.runs.rows.filter((r) => r.kind === "corrections").length, 2)
})

test("demo: the whole road on the simulated account, without a request", async () => {
  const s = setup({}, [order()])
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  await enqueueDue(s.container, ORDER_ID, "payment_captured")
  await issueDue(s.container, "schedule")
  returnOne(s)
  await onReturnReceived(s.container, ORDER_ID, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  await arm(s, true)
  await issueDue(s.container, "schedule")
  await settle(runningKinds)
  const [row] = corrections(s)
  assert.equal(row.status, "issued")
  assert.match(row.number, /^KOR 1\/\d{2}\/\d{4}$/)
  assert.match(row.fakturownia_id, /^74\d{11}$/)
  assert.equal(row.demo, true)
  assert.equal(s.events.find((e) => e.name === "fakturownia.document.corrected")?.data.demo, true)
})

test("writers: the option is the hard switch, the toggle starts off, demo and live never share one", () => {
  const o = resolveOptions(LIVE)
  assert.deepEqual(writerState("corrections", o, null), { key: "corrections", allowed: true, on: false, armed: false, updatedBy: null, updatedAt: null })
  assert.equal(writerState("corrections", o, { on: true, updatedBy: "u", updatedAt: null }).armed, true)
  const hard = resolveOptions({ ...LIVE, writers: { corrections: "false", emails: false } })
  assert.equal(writerState("corrections", hard, { on: true, updatedBy: "u", updatedAt: null }).armed, false)
  assert.equal(writerState("emails", hard, { on: true, updatedBy: "u", updatedAt: null }).allowed, false)
  assert.equal(writerState("ksef", hard, null).allowed, true)
  assert.equal(writerState("corrections", resolveOptions({ ...LIVE, corrections: "off" }), { on: true, updatedBy: "u", updatedAt: null }).armed, false)
  assert.notEqual(writerSettingKey("emails", true), writerSettingKey("emails", false))
})
