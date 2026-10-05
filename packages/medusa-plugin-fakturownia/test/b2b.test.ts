/**
 * B2B buyer data: where the NIP is looked for, whether it is one, the
 * consumer document with a warning instead of a refusal, the company module
 * of the store, and the seller department per sales channel.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { checkTaxId, describeNipSource, findTaxIdIn, nipInText, parseNipSource, resolveNipSources } from "../src/modules/fakturownia/lib/nip.ts"
import { mapBuyer } from "../src/modules/fakturownia/lib/buyer.ts"
import { departmentFor, resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { checkConnection } from "../src/workflows/fakturownia/check.ts"
import { FakeFakturownia, LIVE, order, setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("sources: paths of the option, a company module, and the default of 0.1.0", () => {
  assert.deepEqual(parseNipSource("order.metadata.vat_id"), { kind: "order_metadata", key: "vat_id" })
  assert.deepEqual(parseNipSource("billing_address.metadata.nip"), { kind: "billing_metadata", key: "nip" })
  assert.deepEqual(parseNipSource("billing_address.company"), { kind: "billing_company" })
  assert.deepEqual(parseNipSource("company:company"), { kind: "company", entity: "company", customerField: "customer_id", nipField: "nip", nameField: "name" })
  assert.deepEqual(parseNipSource({ entity: "b2b_company", nipField: "tax_id", nameField: null }), {
    kind: "company",
    entity: "b2b_company",
    customerField: "customer_id",
    nipField: "tax_id",
    nameField: null,
  })
  for (const bad of ["order.nip", "billing_address.phone", { entity: "drop table" }, 42, null]) assert.equal(parseNipSource(bad), null, String(bad))
  assert.deepEqual(resolveNipSources(undefined, ["nip"]).map(describeNipSource), ["order.metadata.nip", "billing_address.metadata.nip", "billing_address.tax_id"])
  assert.deepEqual(resolveNipSources("order.metadata.nip, nope", ["x"]).map(describeNipSource), ["order.metadata.nip"])
})

test("a NIP passes the checksum; an EU VAT number keeps its shape; the rest is not a tax ID", () => {
  assert.deepEqual(checkTaxId("PL 123-456-32-18"), { kind: "valid", taxId: "1234563218" })
  assert.deepEqual(checkTaxId("NIP: 525-244-57-67"), { kind: "valid", taxId: "5252445767" })
  assert.deepEqual(checkTaxId("1234563219"), { kind: "invalid", reason: "checksum" })
  assert.deepEqual(checkTaxId("123456"), { kind: "invalid", reason: "length" })
  assert.deepEqual(checkTaxId("DE123456789"), { kind: "valid", taxId: "DE123456789" })
  assert.deepEqual(checkTaxId("DE1"), { kind: "invalid", reason: "shape" })
  assert.deepEqual(checkTaxId("brak"), { kind: "none" })
  assert.deepEqual(checkTaxId(null), { kind: "none" })
})

test("a NIP typed into the company name is found only when it passes the checksum", () => {
  assert.equal(nipInText("Salon Anna sp. z o.o., NIP 123-456-32-18"), "1234563218")
  assert.equal(nipInText("Firma PL5252445767"), "5252445767")
  assert.equal(nipInText("Firma, tel. 600 700 800 9"), null)
  assert.equal(nipInText("Firma 1234563219"), null)
  assert.equal(nipInText(undefined), null)
})

test("the first source with a value decides; a wrong NIP is reported, not replaced by a later one", () => {
  const sources = resolveNipSources(["order.metadata.nip", "billing_address.metadata.nip"], [])
  const found = findTaxIdIn({ metadata: { nip: "1234563219" }, billing_address: { metadata: { nip: "5252445767" } } }, sources)
  assert.deepEqual([found.verdict.kind, found.source], ["invalid", "order.metadata.nip"])
  const later = findTaxIdIn({ metadata: { nip: "" }, billing_address: { metadata: { nip: "5252445767" } } }, sources)
  assert.deepEqual([later.verdict.kind, later.source], ["valid", "billing_address.metadata.nip"])
})

test("an invalid NIP or a company name without one: a consumer document and a warning, never the NIP stored", () => {
  const bad = mapBuyer(order({ metadata: { nip: "1234563219" }, billing_address: { ...order().billing_address, company: "Firma sp. z o.o." } }) as never, resolveNipSources(undefined, ["nip"]))
  assert.deepEqual([bad.type, bad.fields.buyer_company, bad.fields.buyer_tax_no], ["person", false, undefined])
  assert.deepEqual(bad.warning, { code: "invalid_nip", reason: "checksum", source: "order.metadata.nip" })
  assert.ok(!JSON.stringify(bad.warning).includes("1234563219"))
  const named = mapBuyer(order({ billing_address: { ...order().billing_address, company: "Firma sp. z o.o." } }) as never, resolveNipSources(undefined, ["nip"]))
  assert.deepEqual(named.warning, { code: "company_without_nip", reason: null, source: null })
  assert.equal(mapBuyer(order() as never, ["nip"]).warning, null)
})

test("live: an invalid NIP gives a consumer document (a receipt here) with the warning on the row, not a 422", async () => {
  const s = setup({ ...LIVE, receiptForConsumers: true }, [order({ metadata: { nip: "1234563219" }, billing_address: { ...order().billing_address, company: "Firma sp. z o.o." } })])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const row = s.documents.rows[0]
  assert.deepEqual([row.kind, row.status, row.buyer_type], ["receipt", "issued", "person"])
  assert.deepEqual(row.buyer_warning, { code: "invalid_nip", reason: "checksum", source: "order.metadata.nip" })
  const sent = fake.calls.find((c) => c.method === "POST")!.body.invoice
  assert.deepEqual([sent.buyer_company, sent.buyer_tax_no], [false, undefined])
})

test("a company module of the store: the NIP and the name of the order's customer's company", async () => {
  const s = setup({ ...LIVE, nipSources: ["order.metadata.nip", { entity: "company" }] }, [order({ customer_id: "cus_1" })])
  s.entities.set("company", [{ customer_id: "cus_1", nip: "525-244-57-67", name: "Radgost sp. z o.o." }])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const sent = fake.calls.find((c) => c.method === "POST")!.body.invoice
  assert.deepEqual([sent.buyer_company, sent.buyer_tax_no, sent.buyer_name], [true, "5252445767", "Radgost sp. z o.o."])
  assert.equal(s.documents.rows[0].buyer_type, "company")

  const unknown = setup({ ...LIVE, nipSources: [{ entity: "no_such_module" }] }, [order({ customer_id: "cus_1" })])
  globalThis.fetch = new FakeFakturownia().fetch
  await enqueueDue(unknown.container, order().id, "payment_captured")
  await issueDue(unknown.container, "schedule")
  assert.equal(unknown.documents.rows[0].status, "issued", "a source that cannot be read never stops a document")
  assert.equal(unknown.logs.filter((l) => l.includes("no_such_module")).length, 1, "logged once")
})

test("the seller department per sales channel, the main one otherwise; the check names each one", async () => {
  const options = { ...LIVE, departmentId: 101, departmentsBySalesChannel: { sc_b2b: 202, "bad id!": 3, sc_zero: 0 } }
  const o = resolveOptions(options)
  assert.deepEqual(o.departmentsBySalesChannel, [["sc_b2b", 202]])
  assert.equal(departmentFor(o, "sc_b2b"), 202)
  assert.equal(departmentFor(o, "sc_retail"), 101)
  assert.equal(departmentFor(o, null), 101)
  const s = setup(options, [order({ sales_channel_id: "sc_b2b" }), order({ id: "order_2", display_id: 1043, sales_channel_id: "sc_retail" })])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await enqueueDue(s.container, "order_2", "payment_captured")
  await issueDue(s.container, "schedule")
  assert.deepEqual(
    fake.calls.filter((c) => c.method === "POST").map((c) => c.body.invoice.department_id),
    [202, 101],
  )
  const check = await checkConnection(s.container)
  assert.deepEqual(check?.channelDepartments, [{ salesChannelId: "sc_b2b", departmentId: 202, found: false, name: null }])
})
