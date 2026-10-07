/**
 * The smaller fixes of 0.3.0, each with the case that used to go wrong:
 * EU VAT numbers by country, a receipt that never names a company, "Mark as
 * issued" that checks what it links, the cancellation rule for plans, the
 * history kept per mode, a correction that waits for KSeF, the converted
 * proforma that is no longer unpaid, how often the admin asks, what is
 * masked before it is stored, and the guards of the routes.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { checkTaxId, isEuVatShape } from "../src/modules/fakturownia/lib/nip.ts"
import { mapBuyer } from "../src/modules/fakturownia/lib/buyer.ts"
import { buildDocument } from "../src/modules/fakturownia/lib/document.ts"
import { resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { isUnpaid, unpaidFilters } from "../src/modules/fakturownia/lib/unpaid.ts"
import { pollInterval, POLL_DUE_MS, POLL_ISSUING_MS, POLL_SLOW_MS } from "../src/modules/fakturownia/lib/poll.ts"
import { maskForStorage } from "../src/modules/fakturownia/lib/security.ts"
import { POLICY, POLICY_DEFINITIONS } from "../src/modules/fakturownia/lib/policies.ts"
import { isTrustedWrite } from "../src/modules/fakturownia/lib/kit-guards.ts"
import { ActionError, enqueueDue, issueDue, markIssued } from "../src/workflows/fakturownia/documents.ts"
import { approvePlan, planCorrections } from "../src/workflows/fakturownia/corrections.ts"
import { onOrderCanceled, onReturnReceived } from "../src/workflows/fakturownia/events.ts"
import { recordRun } from "../src/workflows/fakturownia/runtime.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { FakeFakturownia, LIVE, order, setup, today, type Row } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("EU VAT numbers: a known country prefix and its own shape; any two letters are not enough", () => {
  for (const ok of ["DE123456789", "ATU12345678", "NL123456789B01", "FRXX123456789", "EL123456789", "IE1234567WA", "ESX1234567X", "CZ12345678", "XI123456789"]) {
    assert.equal(isEuVatShape(ok), true, ok)
    assert.deepEqual(checkTaxId(ok), { kind: "valid", taxId: ok })
  }
  for (const bad of ["US123456", "AB12", "GR123456789", "DE12345678", "ATU1234567", "NL123456789", "SE12345678901"]) {
    assert.equal(isEuVatShape(bad), false, bad)
    assert.deepEqual(checkTaxId(bad), { kind: "invalid", reason: "shape" }, bad)
  }
  assert.deepEqual(checkTaxId("PL 123-456-32-18"), { kind: "valid", taxId: "1234563218" })
})

test("a receipt names a consumer even when a NIP appeared after it was queued; the row says so", () => {
  const o = resolveOptions({ ...LIVE, receiptForConsumers: true })
  const withNip = order({ metadata: { nip: "1234563218" }, billing_address: { ...order().billing_address, company: "Firma Testowa sp. z o.o." } })
  assert.equal(mapBuyer(withNip, o.nipSources).type, "company")
  const receipt = buildDocument(withNip as never, o, { kind: "receipt", today: today(), oidUnique: true })
  assert.equal(receipt.invoice.buyer_company, false)
  assert.equal(receipt.invoice.buyer_tax_no, undefined)
  assert.equal(receipt.summary.buyerType, "person")
  assert.deepEqual(receipt.summary.buyerWarning, { code: "nip_on_receipt", reason: null, source: "order.metadata.nip" })
  const vat = buildDocument(withNip as never, o, { kind: "vat", today: today(), oidUnique: true })
  assert.deepEqual([vat.invoice.buyer_company, vat.invoice.buyer_tax_no], [true, "1234563218"])
})

test("Mark as issued checks the kind, the order number and that no other row holds the document", async () => {
  const s = setup(LIVE, [order(), order({ id: "order_02", display_id: 1043 })])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_no_commit", "ok"]
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = s.documents.rows[0]
  assert.equal(row.status, "unknown")
  const proforma = fake.add({ oid: "1042", kind: "proforma", price_gross: "143.0", number: "PRO 7/10/2026" })
  await assert.rejects(markIssued(s.container, row.id, { number: "PRO 7/10/2026", fakturowniaId: String(proforma.id) }), (e: unknown) => e instanceof ActionError && e.status === 409 && /kind proforma/.test(e.message))
  const other = fake.add({ oid: "1043", kind: "vat", price_gross: "143.0", number: "FV 8/10/2026" })
  await assert.rejects(markIssued(s.container, row.id, { number: "FV 8/10/2026", fakturowniaId: String(other.id) }), (e: unknown) => e instanceof ActionError && e.status === 409 && /order number 1043/.test(e.message))

  /* Another row already holds a document: it cannot be linked twice. */
  const ours = fake.add({ oid: "1042", kind: "vat", price_gross: "143.0", number: "FV 9/10/2026" })
  s.documents.rows.push({ ...row, id: "fkdoc_twin", order_id: "order_02", display_id: 1043, status: "issued", fakturownia_id: String(ours.id) })
  await assert.rejects(markIssued(s.container, row.id, { number: "FV 9/10/2026", fakturowniaId: String(ours.id) }), (e: unknown) => e instanceof ActionError && e.status === 409 && /#1043/.test(e.message))
  s.documents.rows.pop()
  const marked = await markIssued(s.container, row.id, { number: "FV 9/10/2026", fakturowniaId: String(ours.id) })
  assert.deepEqual([marked.status, marked.fakturownia_id], ["issued", String(ours.id)])
})

test("cancelOnOrderCanceled: false: a canceled order leaves its invoice alone, no plan to zero either", async () => {
  const s = setup({ ...LIVE, cancelOnOrderCanceled: false }, [order()])
  globalThis.fetch = new FakeFakturownia().fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  s.orders.get(order().id)!.status = "canceled"
  await onOrderCanceled(s.container, order().id)
  assert.equal(s.documents.rows[0].status, "issued")
  assert.equal(s.plans.rows.length, 0)
  assert.equal((await planCorrections(s.container, order().id, null)).reason, "cancel_rule_off")
})

test("a correction waits until KSeF accepted the invoice it corrects, then goes out once", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const original = s.documents.rows[0]
  assert.equal(original.gov_status, "processing")
  s.orders.get(order().id)!.items[0].detail = { quantity: 2, return_received_quantity: 1 }
  await onReturnReceived(s.container, order().id, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  await s.planStore.setSetting(writerSettingKey("corrections", false), { on: true }, "user_1")
  await issueDue(s.container, "schedule")
  const correction = s.documents.rows.find((r) => r.kind === "correction")!
  assert.deepEqual([correction.status, correction.error_code], ["pending", "waiting_for_ksef"])
  assert.equal(fake.calls.filter((c) => c.method === "POST" && c.body?.invoice?.kind === "correction").length, 0)

  original.gov_status = "ok"
  fake.docs[0].gov_status = "ok"
  correction.next_attempt_at = new Date(0)
  await issueDue(s.container, "schedule")
  assert.equal(correction.status, "issued")
  assert.equal(fake.calls.filter((c) => c.method === "POST" && c.body?.invoice?.kind === "correction").length, 1)
})

test("a list that leaves out the private note: each correction of the invoice is read, and ours is found by its marker", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  /* The documented list does not promise `internal_note`: this one never sends it. Set before the first request (the client keeps its fetch). */
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const res = await fake.fetch(input, init)
    if ((init?.method ?? "GET") !== "GET" || new URL(String(input)).pathname !== "/invoices.json") return res
    const list = (await res.json()) as Row[]
    return new Response(JSON.stringify(list.map(({ internal_note: _note, ...rest }) => rest)), { status: 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const original = s.documents.rows[0]
  original.gov_status = "ok"
  fake.docs[0].gov_status = "ok"
  fake.createModes = ["ok", "lost_no_commit"]
  s.orders.get(order().id)!.items[0].detail = { quantity: 2, return_received_quantity: 1 }
  await onReturnReceived(s.container, order().id, "return_1")
  await approvePlan(s.container, s.plans.rows[0].id, { revision: 1, actorId: "user_1" })
  await s.planStore.setSetting(writerSettingKey("corrections", false), { on: true }, "user_1")
  await issueDue(s.container, "schedule")
  const row = s.documents.rows.find((r) => r.kind === "correction")!
  assert.equal(row.status, "unknown")
  /* Two corrections of the same value in Fakturownia: another row's, and ours. */
  const link = { kind: "correction", oid: "1042", from_invoice_id: Number(original.fakturownia_id), invoice_id: Number(original.fakturownia_id), price_gross: "-61.5" }
  fake.add({ ...link, internal_note: "Medusa #1042 [medusa:fkdoc_someone_else]", number: "KOR 7/10/2026" })
  fake.add({ ...link, internal_note: `Medusa #1042 [medusa:${row.id}]`, number: "KOR 8/10/2026" })
  row.create_sent_at = new Date(Date.now() - 10 * 60_000)
  row.next_attempt_at = new Date(0)
  await issueDue(s.container, "schedule")
  assert.deepEqual([row.status, row.number], ["issued", "KOR 8/10/2026"])
})

test("the history keeps 50 runs per kind in each mode: the demo never pushes the real account's runs out", async () => {
  const live = setup(LIVE)
  for (let i = 0; i < 30; i += 1) live.runs.rows.push({ id: `fkrun_live_${i}`, kind: "issue", source: "api", started_at: new Date(Date.now() - 1000 * (60 - i)), deleted_at: null })
  for (let i = 0; i < 60; i += 1) live.runs.rows.push({ id: `fkrun_demo_${i}`, kind: "issue", source: "demo", started_at: new Date(Date.now() - 1000 * i), deleted_at: null })
  await recordRun(live.container.resolve("fakturownia"), { kind: "issue", trigger: "manual", status: "ok", startedAt: new Date() })
  assert.equal(live.runs.rows.filter((r) => r.source === "api").length, 31, "live runs are all kept (under 50)")
  assert.equal(live.runs.rows.filter((r) => r.source === "demo").length, 60, "demo runs are not pruned by a live run")
})

test("a proforma turned into a final document is converted, and no longer unpaid", async () => {
  const s = setup({ ...LIVE, documentFlow: "proforma_then_vat", trigger: "order_placed" }, [order({ payment_collections: [] })])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "order_placed")
  await issueDue(s.container, "schedule")
  const proforma = s.documents.rows[0]
  assert.equal(proforma.kind, "proforma")
  assert.equal(isUnpaid(proforma), true)
  s.orders.get(order().id)!.fulfillments = [{ id: "ful_1" }]
  await enqueueDue(s.container, order().id, "fulfillment")
  await issueDue(s.container, "schedule")
  const vat = s.documents.rows.find((r) => r.kind === "vat")!
  assert.equal(vat.status, "issued")
  assert.equal(vat.from_fakturownia_id, proforma.fakturownia_id)
  assert.ok(proforma.converted_at instanceof Date)
  assert.equal(isUnpaid(proforma), false)
  assert.deepEqual(unpaidFilters(false), { demo: false, status: "issued", paid: false, kind: ["vat", "proforma", "receipt"], converted_at: null, cancel_requested_at: null })
  assert.equal(isUnpaid({ kind: "correction", status: "issued", paid: false }), false)
  assert.equal(isUnpaid({ kind: "proforma", status: "issued", paid: false, fakturownia_id: "9" }, new Set(["9"])), false, "a 0.2.x proforma named by its final document")
})

test("the admin asks often only while something is being issued; never for what waits for a person", () => {
  const now = Date.parse("2026-10-07T10:00:00Z")
  assert.equal(pollInterval([], now), false)
  assert.equal(pollInterval([{ status: "issued", govState: "accepted" }, { status: "failed" }, { status: "canceled" }], now), false)
  assert.equal(pollInterval([{ status: "issuing" }], now), POLL_ISSUING_MS)
  assert.equal(pollInterval([{ status: "pending", nextAttemptAt: "2026-10-07T10:00:30Z" }], now), POLL_DUE_MS)
  assert.equal(pollInterval([{ status: "pending", nextAttemptAt: "2026-10-07T14:00:00Z" }], now), POLL_SLOW_MS, "a retry in hours")
  assert.equal(pollInterval([{ status: "pending", errorCode: "waiting_for_writer" }], now), false, "a correction waiting for the writer waits for a person")
  assert.equal(pollInterval([{ status: "issued", govState: "processing" }], now), POLL_SLOW_MS)
  assert.equal(pollInterval([{ status: "issued", emailStatus: "pending" }, { status: "unknown" }], now), POLL_SLOW_MS)
  assert.equal(pollInterval([{ status: "issued", govState: "processing" }, { status: "issuing" }], now), POLL_ISSUING_MS)
})

test("stored texts: the token, token-like values and e-mail addresses are masked; KSeF and document numbers stay", () => {
  const text = maskForStorage(
    "Fakturownia create: HTTP_422 buyer_email anna.nowak@example.com is wrong (token fkTEST0123456789abcdefGHIJ/mojafirma), KSeF 1234563218-20261007-0123456789AB, FV 12/10/2026",
    ["fkTEST0123456789abcdefGHIJ/mojafirma"],
  )
  assert.doesNotMatch(text, /anna\.nowak|fkTEST/)
  assert.match(text, /a\*\*\*@e\*\*\*\.com/)
  assert.match(text, /1234563218-20261007-0123456789AB/)
  assert.match(text, /FV 12\/10\/2026/)
})

test("routes: writes need JSON or the Koda header; RBAC policies on every admin route, stronger ones for the risky writes", async () => {
  assert.equal(isTrustedWrite({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }), false)
  assert.equal(isTrustedWrite({ method: "POST", headers: { "content-type": "text/plain" } }), false)
  assert.equal(isTrustedWrite({ method: "POST", headers: { "content-type": "application/json" } }), true)
  assert.equal(isTrustedWrite({ method: "GET", headers: {} }), true)
  const { default: config } = await import("../src/api/middlewares.ts")
  const routes = (config as { routes: Array<{ matcher: string; methods?: string[]; policies?: unknown[]; middlewares?: unknown[] }> }).routes
  const admin = routes.filter((r) => r.matcher.startsWith("/admin/fakturownia"))
  const all = admin.find((r) => r.matcher === "/admin/fakturownia*" && !r.methods)
  assert.ok(all && (all.middlewares?.length ?? 0) === 1, "the write guard on every admin route")
  assert.deepEqual(all?.policies, [POLICY.read])
  const writes = admin.find((r) => r.matcher === "/admin/fakturownia*" && r.methods?.includes("POST"))
  assert.deepEqual(writes?.policies, [POLICY.update])
  const policyOf = (matcher: string) => admin.find((r) => r.matcher === matcher)?.policies
  assert.deepEqual(policyOf("/admin/fakturownia/corrections/*/approve"), [POLICY.approve])
  assert.deepEqual(policyOf("/admin/fakturownia/documents/*/email"), [POLICY.send])
  assert.deepEqual(policyOf("/admin/fakturownia/documents/*/ksef-resend"), [POLICY.send])
  assert.deepEqual(policyOf("/admin/fakturownia/writers"), [POLICY.manage])
  assert.deepEqual(
    POLICY_DEFINITIONS.map((p) => `${p.resource}:${p.operation}`),
    ["fakturownia:read", "fakturownia:update", "fakturownia:approve", "fakturownia:send", "fakturownia:manage"],
  )
  const store = routes.find((r) => r.matcher === "/store/fakturownia*")
  assert.ok(store && (store.middlewares?.length ?? 0) === 1, "customers only on the store routes")
})
