import { test } from "node:test"
import assert from "node:assert/strict"
import { buildFinalFromProforma } from "../src/modules/fakturownia/lib/conversion.ts"
import { PayloadError } from "../src/modules/fakturownia/lib/errors.ts"

/** A proforma as GET /invoices/{id}.json returns it (strings where Fakturownia gives strings). */
const proforma = {
  id: 501234567,
  number: "PRO 3/10/2026",
  kind: "proforma",
  oid: "1042",
  currency: "PLN",
  lang: "pl",
  department_id: 101,
  category_id: null,
  place: "Warszawa",
  payment_type: "transfer",
  description: "Zamówienie 1042",
  price_gross: "143.0",
  paid: "0.0",
  buyer_name: "Anna Nowak",
  buyer_company: false,
  buyer_first_name: "Anna",
  buyer_last_name: "Nowak",
  buyer_tax_no: null,
  buyer_email: "anna@example.com",
  buyer_street: "ul. Długa 5 m. 3",
  buyer_post_code: "00-001",
  buyer_city: "Warszawa",
  buyer_country: "PL",
  seller_name: "Moja Firma sp. z o.o.",
  token: "public-view-token",
  positions: [
    { id: 9001, invoice_id: 501234567, product_id: 77, name: "Krem nawilżający, 50 ml", code: "KREM-50", quantity: "2.0", quantity_unit: "szt.", total_price_gross: "123.0", tax: "23" },
    { id: 9002, invoice_id: 501234567, name: "InPost Paczkomat", quantity: "1.0", quantity_unit: "szt.", total_price_gross: "20.0", tax: "23" },
  ],
}

const args = { kind: "vat" as const, receiptKind: "receipt", today: "2026-10-12", capturedInFull: false, paymentTermDays: 7, fallback: { issuePlace: "", lang: "pl" } }

test("the VAT invoice copies the positions without their ids, links the proforma, dates today", () => {
  const { invoice, summary } = buildFinalFromProforma(proforma, args)
  assert.equal(invoice.kind, "vat")
  assert.equal(invoice.from_invoice_id, 501234567)
  assert.equal(invoice.issue_date, "2026-10-12")
  assert.equal(invoice.sell_date, "2026-10-12")
  assert.deepEqual(invoice.positions, [
    { name: "Krem nawilżający, 50 ml", code: "KREM-50", quantity_unit: "szt.", quantity: 2, total_price_gross: 123, tax: "23" },
    { name: "InPost Paczkomat", quantity_unit: "szt.", quantity: 1, total_price_gross: 20, tax: "23" },
  ])
  assert.ok(!JSON.stringify(invoice.positions).includes("9001"), "never the proforma's position ids")
  assert.equal(summary.fromInvoiceId, "501234567")
  assert.equal(summary.totalGross, 143)
  assert.equal(summary.oid, "1042")
})

test("the whole buyer travels, including its type (the production integration forgot it)", () => {
  const { invoice, summary } = buildFinalFromProforma(proforma, args)
  assert.equal(invoice.buyer_company, false)
  assert.equal(invoice.buyer_first_name, "Anna")
  assert.equal(invoice.buyer_last_name, "Nowak")
  assert.equal(invoice.buyer_name, "Anna Nowak")
  assert.equal(invoice.buyer_email, "anna@example.com")
  assert.equal(summary.buyerType, "person")
  const company = buildFinalFromProforma({ ...proforma, buyer_company: "1", buyer_tax_no: "1234563218", buyer_first_name: null, buyer_last_name: null }, args)
  assert.equal(company.invoice.buyer_company, true)
  assert.equal(company.invoice.buyer_tax_no, "1234563218")
  assert.equal(company.summary.buyerType, "company")
})

test("order number, currency, department, place and remarks are copied; seller and the view token are not", () => {
  const { invoice } = buildFinalFromProforma(proforma, args)
  assert.equal(invoice.oid, "1042")
  assert.equal(invoice.currency, "PLN")
  assert.equal(invoice.department_id, 101)
  assert.equal(invoice.place, "Warszawa")
  assert.equal(invoice.description, "Zamówienie 1042")
  assert.equal(invoice.seller_name, undefined)
  assert.equal(invoice.token, undefined)
  assert.equal(invoice.category_id, undefined, "empty values are not copied")
  assert.equal(invoice.oid_unique, undefined, "the proforma holds the same order number")
})

test("payment: captured now is paid; a paid proforma stays paid; otherwise the payment term", () => {
  const captured = buildFinalFromProforma(proforma, { ...args, capturedInFull: true })
  assert.equal(captured.invoice.paid, "143.00")
  assert.equal(captured.invoice.payment_to_kind, "off")
  const paidProforma = buildFinalFromProforma({ ...proforma, paid: "143.0" }, args)
  assert.equal(paidProforma.summary.paid, true)
  const open = buildFinalFromProforma(proforma, args)
  assert.equal(open.invoice.paid, undefined)
  assert.equal(open.invoice.payment_to_kind, 7)
  assert.equal(open.invoice.payment_to, "2026-10-19")
})

test("discount fields only when a copied position carries a discount", () => {
  assert.equal(buildFinalFromProforma(proforma, args).invoice.show_discount, undefined)
  const discounted = buildFinalFromProforma(
    { ...proforma, discount_kind: "percent_unit", positions: [{ ...proforma.positions[0], price_gross: "61.5", discount_percent: "10" }] },
    args,
  )
  assert.equal(discounted.invoice.show_discount, true)
  assert.equal(discounted.invoice.discount_kind, "percent_unit")
  assert.equal((discounted.invoice.positions as Array<Record<string, unknown>>)[0].discount_percent, 10)
})

test("a receipt after a proforma: the receipt kind, never a tax ID, never a company", () => {
  const { invoice } = buildFinalFromProforma({ ...proforma, buyer_company: true, buyer_tax_no: "1234563218", buyer_tax_no_kind: "" }, { ...args, kind: "receipt", receiptKind: "receipt" })
  assert.equal(invoice.kind, "receipt")
  assert.equal(invoice.buyer_company, false)
  assert.equal("buyer_tax_no" in invoice, false)
  assert.equal("buyer_tax_no_kind" in invoice, false)
})

test("an unreadable or empty proforma stops the conversion instead of issuing an empty invoice", () => {
  assert.throws(() => buildFinalFromProforma({ ...proforma, id: undefined }, args), (e: unknown) => e instanceof PayloadError && e.code === "proforma_unreadable")
  assert.throws(() => buildFinalFromProforma({ ...proforma, positions: [] }, args), (e: unknown) => e instanceof PayloadError && e.code === "proforma_empty")
  assert.equal(buildFinalFromProforma({ ...proforma, place: null }, { ...args, fallback: { issuePlace: "Kraków", lang: "pl" } }).invoice.place, "Kraków")
})
