import { test } from "node:test"
import assert from "node:assert/strict"
import {
  apiKind,
  buildDocument,
  dueKinds,
  finalKind,
  isFulfilled,
  manualKind,
  orderOid,
  paymentFacts,
  paymentTypeFor,
  type DueState,
} from "../src/modules/fakturownia/lib/document.ts"
import { resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { LIVE, order, unpaid } from "./helpers.ts"

const base: DueState = {
  flow: "vat",
  trigger: "payment_captured",
  canceled: false,
  capturedInFull: false,
  fulfilled: false,
  hasProforma: false,
  finalKind: "vat",
}

test("final kind: a company always gets a VAT invoice; a person a receipt only with receiptForConsumers", () => {
  assert.equal(finalKind({ receiptForConsumers: false }, "person"), "vat")
  assert.equal(finalKind({ receiptForConsumers: true }, "person"), "receipt")
  assert.equal(finalKind({ receiptForConsumers: true }, "company"), "vat")
  assert.equal(apiKind("receipt", "receipt"), "receipt")
  assert.equal(apiKind("receipt", "fiscal_receipt"), "fiscal_receipt")
  assert.equal(apiKind("vat", "fiscal_receipt"), "vat")
})

test("vat flow: the final document when the trigger is met, nothing before", () => {
  assert.deepEqual(dueKinds({ ...base }), [])
  assert.deepEqual(dueKinds({ ...base, capturedInFull: true }), ["vat"])
  assert.deepEqual(dueKinds({ ...base, trigger: "order_placed" }), ["vat"])
  assert.deepEqual(dueKinds({ ...base, trigger: "order_placed", finalKind: "receipt" }), ["receipt"])
  assert.deepEqual(dueKinds({ ...base, trigger: "order_placed", canceled: true }), [], "a canceled order gets nothing")
})

test("proforma flow: a proforma at the trigger, the final document after the first fulfillment", () => {
  const flow = { ...base, flow: "proforma_then_vat" as const }
  assert.deepEqual(dueKinds({ ...flow, capturedInFull: true }), ["proforma"])
  assert.deepEqual(dueKinds({ ...flow, trigger: "order_placed" }), ["proforma"])
  assert.deepEqual(dueKinds({ ...flow, capturedInFull: true, hasProforma: true, fulfilled: true }), ["vat"])
  assert.deepEqual(dueKinds({ ...flow, hasProforma: true, fulfilled: true }), ["vat"], "an unpaid order with a proforma gets its VAT after fulfillment")
  assert.deepEqual(dueKinds({ ...flow, fulfilled: true }), [], "no trigger and no proforma: wait")
  assert.deepEqual(dueKinds({ ...flow, fulfilled: true, capturedInFull: true }), ["vat"], "fulfilled before the trigger: straight to the final document")
  assert.deepEqual(dueKinds({ ...flow, hasProforma: true, fulfilled: false }), [], "nothing new before the fulfillment")
})

test("Issue now: the proforma before the fulfillment in the proforma flow, the final document otherwise", () => {
  assert.equal(manualKind({ flow: "proforma_then_vat", fulfilled: false, finalKind: "vat" }), "proforma")
  assert.equal(manualKind({ flow: "proforma_then_vat", fulfilled: true, finalKind: "receipt" }), "receipt")
  assert.equal(manualKind({ flow: "vat", fulfilled: false, finalKind: "vat" }), "vat")
  assert.equal(isFulfilled({ fulfillments: [{ id: "f", canceled_at: "2026-10-05" }] }), false)
  assert.equal(isFulfilled({ fulfillments: [{ id: "f", canceled_at: null }] }), true)
})

test("payment facts: captures count, canceled payments and collections do not, partial is not paid", () => {
  const full = paymentFacts([{ status: "completed", payments: [{ provider_id: "pp_stripe_stripe", captures: [{ amount: 100 }, { amount: 43 }] }] }], 143, ["pp_cod"])
  assert.deepEqual(full, { providerId: "pp_stripe_stripe", captured: true, cod: false, amountCaptured: 143 })
  const byDate = paymentFacts([{ payments: [{ provider_id: "pp_x", amount: 143, captured_at: "2026-10-05" }] }], 143, [])
  assert.equal(byDate.captured, true)
  const partial = paymentFacts([{ payments: [{ provider_id: "pp_x", captures: [{ amount: 100 }] }] }], 143, [])
  assert.equal(partial.captured, false)
  const canceled = paymentFacts(
    [
      { status: "canceled", payments: [{ provider_id: "pp_a", captures: [{ amount: 143 }] }] },
      { payments: [{ provider_id: "pp_b", canceled_at: "2026-10-05", captures: [{ amount: 143 }] }] },
    ],
    143,
    [],
  )
  assert.equal(canceled.captured, false)
  assert.equal(paymentFacts([{ payments: [{ provider_id: "pp_cod_cod" }] }], 143, ["pp_cod"]).cod, true)
})

test("payment type: cash on delivery, configured prefixes (longest first), transfer otherwise", () => {
  const types = resolveOptions({ paymentTypes: { pp_stripe: "card", "pp_stripe-blik": "blik" } }).paymentTypes
  assert.equal(paymentTypeFor("pp_cod_cod", true, types), "cash_on_delivery")
  assert.equal(paymentTypeFor("pp_stripe-blik_stripe", false, types), "blik")
  assert.equal(paymentTypeFor("pp_stripe_stripe", false, types), "card")
  assert.equal(paymentTypeFor("pp_payu_payu", false, types), "transfer")
  assert.equal(paymentTypeFor(null, false, types), "transfer")
})

test("order number: the display id, with the prefix", () => {
  assert.equal(orderOid(1042, ""), "1042")
  assert.equal(orderOid(1042, "M-"), "M-1042")
  assert.equal(orderOid(null, "M-"), null)
})

test("a VAT invoice for a paid order: every field Fakturownia needs, oid_unique, no discount fields", () => {
  const o = resolveOptions({ ...LIVE, issuePlace: "Warszawa", departmentId: 101, categoryId: 7, paymentTypes: { pp_stripe: "card" } })
  const { invoice, summary } = buildDocument(order() as never, o, { kind: "vat", today: "2026-10-05", oidUnique: true })
  assert.deepEqual(invoice, {
    kind: "vat",
    issue_date: "2026-10-05",
    sell_date: "2026-10-05",
    place: "Warszawa",
    department_id: 101,
    category_id: 7,
    lang: "pl",
    currency: "PLN",
    oid: "1042",
    oid_unique: "yes",
    payment_type: "card",
    paid: "143.00",
    payment_to_kind: "off",
    buyer_company: false,
    buyer_name: "Anna Nowak",
    buyer_first_name: "Anna",
    buyer_last_name: "Nowak",
    buyer_street: "ul. Długa 5 m. 3",
    buyer_post_code: "00-001",
    buyer_city: "Warszawa",
    buyer_country: "PL",
    buyer_email: "anna@example.com",
    positions: [
      { name: "Krem nawilżający, 50 ml", code: "KREM-50", quantity: 2, quantity_unit: "szt.", total_price_gross: 123, tax: 23 },
      { name: "InPost Paczkomat", quantity: 1, quantity_unit: "szt.", total_price_gross: 20, tax: 23 },
    ],
  })
  assert.equal("discount_kind" in invoice, false)
  assert.equal("show_discount" in invoice, false)
  assert.equal(summary.buyerType, "person")
  assert.equal(summary.paid, true)
  assert.equal(summary.totalGross, 143)
  assert.ok(!JSON.stringify(summary).includes("Nowak"), "the summary stored in the outbox carries no buyer data")
  assert.ok(!JSON.stringify(summary).includes("anna@example.com"))
})

test("an unpaid document: no paid amount, the payment term in days and as a date", () => {
  const o = resolveOptions({ ...LIVE, paymentTermDays: 14 })
  const { invoice, summary } = buildDocument(unpaid() as never, o, { kind: "proforma", today: "2026-10-25", oidUnique: true })
  assert.equal(invoice.kind, "proforma")
  assert.equal(invoice.paid, undefined)
  assert.equal(invoice.payment_to_kind, 14)
  assert.equal(invoice.payment_to, "2026-11-08")
  assert.equal(invoice.payment_type, "transfer")
  assert.equal(summary.paid, false)
})

test("a receipt is sent with the configured kind; without oidUnique no oid_unique; prefixes apply", () => {
  const o = resolveOptions({ ...LIVE, receiptKind: "fiscal_receipt", oidPrefix: "M" })
  const { invoice } = buildDocument(order() as never, o, { kind: "receipt", today: "2026-10-05", oidUnique: false })
  assert.equal(invoice.kind, "fiscal_receipt")
  assert.equal(invoice.oid, "M1042")
  assert.equal(invoice.oid_unique, undefined)
})

test("cash on delivery: payment type cash_on_delivery, unpaid until captured", () => {
  const cod = unpaid({ payment_collections: [{ status: "awaiting", payments: [{ provider_id: "pp_cod_manual", amount: 143, captures: [] }] }] })
  const { invoice } = buildDocument(cod as never, resolveOptions(LIVE), { kind: "vat", today: "2026-10-05", oidUnique: true })
  assert.equal(invoice.payment_type, "cash_on_delivery")
  assert.equal(invoice.paid, undefined)
})

test("a company buyer: NIP and company name on the invoice", () => {
  const o = resolveOptions(LIVE)
  const { invoice, summary } = buildDocument(
    order({ metadata: { nip: "PL1234563218" }, billing_address: { ...order().billing_address, company: "Firma sp. z o.o." } }) as never,
    o,
    { kind: "vat", today: "2026-10-05", oidUnique: true },
  )
  assert.equal(invoice.buyer_company, true)
  assert.equal(invoice.buyer_tax_no, "1234563218")
  assert.equal(invoice.buyer_name, "Firma sp. z o.o.")
  assert.equal(summary.buyerType, "company")
})
