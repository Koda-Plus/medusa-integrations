/**
 * The correction planner, the correction payload and the lookup of a
 * correction, as pure functions: the order now against the document and the
 * corrections already decided.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  aggregate,
  buildCorrectionInvoice,
  correctionMarker,
  correctionReasonText,
  documentedState,
  diffStates,
  matchCorrection,
  normTax,
  orderTarget,
  originalMismatch,
  planCorrection,
  positionKey,
  sourceKey,
  splitGross,
  spreadReduction,
  storedLine,
  type CorrectionCandidate,
  type PlanInput,
  type PlannedPosition,
} from "../src/modules/fakturownia/lib/corrections.ts"
import { PayloadError } from "../src/modules/fakturownia/lib/errors.ts"
import { order } from "./helpers.ts"

const OPTIONS = { defaultVatRate: 23, shippingPositionName: "Dostawa", quantityUnit: "szt." } as const

/** The positions the plugin stored when it issued the invoice of `order()`. */
const ISSUED = [
  { name: "Krem nawilżający, 50 ml", code: "KREM-50", quantity: 2, unit: "szt.", gross: 123, tax: "23" },
  { name: "InPost Paczkomat", code: null, quantity: 1, unit: "szt.", gross: 20, tax: "23" },
]

const at = "2026-10-06T10:00:00.000Z"

function input(over: Partial<PlanInput> & { order?: Record<string, unknown> } = {}): PlanInput {
  return {
    documentKind: "vat",
    documentPositions: ISSUED,
    applied: [],
    order: order() as never,
    options: OPTIONS,
    sources: [],
    orderVersionAtIssue: 1,
    claimsOrExchanges: false,
    ...over,
  } as PlanInput
}

/** `order()` with one of the two creams returned. */
function returned(qty = 1, damaged = 0, extra: Record<string, unknown> = {}) {
  const base = order()
  return order({ ...extra, items: [{ ...base.items[0], detail: { quantity: 2, return_received_quantity: qty, return_dismissed_quantity: damaged } }] })
}

function refunded(amount: number, over: Record<string, unknown> = {}) {
  return { ...over, payment_collections: [{ status: "completed", payments: [{ provider_id: "pp_stripe", amount: 143, captures: [{ amount: 143 }], refunds: [{ id: "ref_1", amount, created_at: at }] }] }] }
}

test("identity: the SKU (or the name) and the rate; rates written in any way are one rate", () => {
  assert.equal(normTax(23), "23")
  assert.equal(normTax("23%"), "23")
  assert.equal(normTax("23.0"), "23")
  assert.equal(normTax("ZW"), "zw")
  assert.equal(positionKey({ name: "Krem", code: "KREM-50", tax: 23 }), positionKey({ name: "Other name", code: "krem-50", tax: "23.00" }))
  assert.notEqual(positionKey({ name: "Krem", code: "KREM-50", tax: 23 }), positionKey({ name: "Krem", code: "KREM-50", tax: 8 }))
  assert.equal(positionKey({ name: "  Dostawa  kurier ", tax: "23" }), "n:dostawa kurier|23")
})

test("net and VAT inside a gross amount add up to the cent; exempt rates have no VAT", () => {
  assert.deepEqual(splitGross(-61.5, "23"), { net: -50, vat: -11.5 })
  assert.deepEqual(splitGross(10, "8"), { net: 9.26, vat: 0.74 })
  assert.deepEqual(splitGross(10, "zw"), { net: 10, vat: 0 })
})

test("the order now: returned goods (received and damaged) leave the lines, at the price paid", () => {
  const t = orderTarget(returned(1) as never, OPTIONS)
  assert.deepEqual(
    t.lines.map((l) => [l.code, l.quantity, l.gross]),
    [
      ["KREM-50", 1, 61.5],
      [null, 1, 20],
    ],
  )
  assert.deepEqual([t.returnedUnits, t.returnedValue, t.refunded, t.reduction], [1, 61.5, 0, 0])
  const both = orderTarget(returned(1, 1) as never, OPTIONS)
  assert.equal(both.lines.length, 1, "both creams came back")
  assert.equal(both.returnedValue, 123)
})

test("the order now: a refund beyond the returned goods is a price reduction spread over the positions", () => {
  const t = orderTarget(order(refunded(14.3)) as never, OPTIONS)
  assert.equal(t.reduction, 14.3)
  assert.deepEqual(
    t.lines.map((l) => l.gross),
    [110.7, 18],
  )
  assert.equal(
    t.lines.reduce((s, l) => s + l.gross, 0),
    128.7,
  )
  const back = orderTarget(returned(1, 0, refunded(61.5)) as never, OPTIONS)
  assert.equal(back.reduction, 0, "the refund that pays back the return is part of the return")
  const all = spreadReduction([{ name: "a", code: null, tax: "23", unit: "szt.", quantity: 1, gross: 10 }], 25)
  assert.equal(all[0].gross, 0, "never below zero")
})

test("the order now: a canceled order has no positions (a correction to zero)", () => {
  assert.deepEqual(orderTarget(order({ status: "canceled" }) as never, OPTIONS).lines, [])
})

test("the order now: a line without a readable quantity stops the plan", () => {
  const base = order()
  assert.throws(() => orderTarget({ ...base, items: [{ ...base.items[0], detail: null, quantity: undefined }] } as never, OPTIONS), PayloadError)
})

test("plan: nothing without a change in Medusa; a return gives the returned cream, before and after", () => {
  assert.deepEqual(planCorrection(input()), { kind: "none" })
  const v = planCorrection(input({ order: returned(1) as never, sources: [{ type: "return", id: "return_1", at }] }))
  assert.equal(v.kind, "draft")
  if (v.kind === "none") return
  assert.equal(v.positions.length, 1)
  const p = v.positions[0]
  assert.deepEqual([p.name, p.code, p.tax], ["Krem nawilżający, 50 ml", "KREM-50", "23"])
  assert.deepEqual(p.before, { quantity: 2, gross: 123 })
  assert.deepEqual(p.after, { quantity: 1, gross: 61.5 })
  assert.deepEqual(p.delta, { quantity: -1, gross: -61.5, net: -50, vat: -11.5 })
  assert.deepEqual(v.totals, { net: -50, vat: -11.5, gross: -61.5 })
  assert.deepEqual(v.reasons, ["return"])
  assert.deepEqual(v.notes, [{ code: "returned_not_refunded", amount: 61.5 }])
})

test("plan: a return paid back plus a goodwill refund on top: one plan, the return and the reduction", () => {
  const v = planCorrection(input({ order: returned(1, 0, refunded(71.5)) as never }))
  assert.equal(v.kind, "draft")
  if (v.kind === "none") return
  assert.deepEqual(v.reasons, ["return", "refund"])
  assert.equal(v.totals.gross, -71.5)
  assert.deepEqual(v.notes, [{ code: "refund_without_return", amount: 10 }])
})

test("plan: an order edit adds a line and changes a quantity", () => {
  const base = order()
  const edited = order({
    version: 3,
    items: [
      { ...base.items[0], detail: { quantity: 3 }, total: 184.5 },
      { id: "ordli_2", title: "Serum", product_title: "Serum", variant_title: "30 ml", variant_sku: "SER-30", detail: { quantity: 1 }, total: 40, tax_lines: [{ rate: 23 }] },
    ],
  })
  const v = planCorrection(input({ order: edited as never }))
  assert.equal(v.kind, "draft")
  if (v.kind === "none") return
  assert.deepEqual(
    v.positions.map((p) => [p.code, p.before.quantity, p.after.quantity, p.delta.gross]),
    [
      ["KREM-50", 2, 3, 61.5],
      ["SER-30", 0, 1, 40],
    ],
  )
  assert.deepEqual(v.reasons, ["edit"], "the version grew: an edit")
})

test("plan: a canceled order is corrected to zero", () => {
  const v = planCorrection(input({ order: order({ status: "canceled" }) as never, sources: [{ type: "cancel", id: "order_1", at }] }))
  assert.equal(v.kind, "draft")
  if (v.kind === "none") return
  assert.deepEqual(
    v.positions.map((p) => [p.after.quantity, p.after.gross, p.delta.gross]),
    [
      [0, 0, -123],
      [0, 0, -20],
    ],
  )
  assert.equal(v.totals.gross, -143)
  assert.deepEqual(v.reasons, ["cancel"])
})

test("plan: a correction already decided is never planned again", () => {
  const first = planCorrection(input({ order: returned(1) as never }))
  if (first.kind === "none") throw new Error("expected a plan")
  assert.deepEqual(planCorrection(input({ order: returned(1) as never, applied: [first.positions] })), { kind: "none" })
  const second = planCorrection(input({ order: returned(1, 1) as never, applied: [first.positions] }))
  if (second.kind === "none") throw new Error("expected the second return")
  assert.deepEqual(second.positions[0].before, { quantity: 1, gross: 61.5 })
  assert.deepEqual(second.positions[0].after, { quantity: 0, gross: 0 })
})

test("plan: receipts, claims, exchanges and unknown positions are manual, with the reason", () => {
  const receipt = planCorrection(input({ documentKind: "receipt", order: returned(1) as never }))
  assert.equal(receipt.kind, "manual")
  if (receipt.kind !== "none") {
    assert.equal(receipt.manualReason, "receipt")
    assert.equal(receipt.totals.gross, -61.5, "the amounts for the register of returns")
  }
  const claim = planCorrection(input({ order: returned(1) as never, claimsOrExchanges: true }))
  assert.equal(claim.kind !== "none" && claim.manualReason, "claim_or_exchange")
  const unknown = planCorrection(input({ documentPositions: null, order: returned(1) as never }))
  assert.equal(unknown.kind !== "none" && unknown.manualReason, "unknown_positions")
})

test("plan: a manual check plans any difference, also without a change signal", () => {
  const base = order()
  const differs = order({ items: [{ ...base.items[0], total: 120 }] })
  assert.deepEqual(planCorrection(input({ order: differs as never })), { kind: "none" })
  assert.equal(planCorrection(input({ order: differs as never, force: true })).kind, "draft")
})

test("the documented state adds decided corrections to the issued positions", () => {
  const delta: PlannedPosition = {
    key: positionKey({ name: "x", code: "KREM-50", tax: "23" }),
    name: "Krem",
    code: "KREM-50",
    tax: "23",
    unit: "szt.",
    before: { quantity: 2, gross: 123 },
    after: { quantity: 1, gross: 61.5 },
    delta: { quantity: -1, gross: -61.5, net: -50, vat: -11.5 },
  }
  const state = documentedState(ISSUED.map(storedLine), [[delta]])
  assert.deepEqual([...state.values()].map((s) => [s.quantity, s.gross]), [
    [1, 61.5],
    [1, 20],
  ])
  assert.equal(diffStates(state, aggregate(ISSUED.map(storedLine))).length, 1)
})

test("the business key: the order's sources sorted, the scan left out, the plan id without any", () => {
  assert.equal(
    sourceKey(
      [
        { type: "refund", id: "ref_2", at },
        { type: "return", id: "return_1", at },
        { type: "scan", id: "x", at },
        { type: "return", id: "return_1", at },
      ],
      "fkcor_1",
    ),
    "refund:ref_2+return:return_1",
  )
  assert.equal(sourceKey([], "fkcor_1"), "plan:fkcor_1")
  const long = sourceKey(
    Array.from({ length: 40 }, (_, i) => ({ type: "refund" as const, id: `ref_${String(i).padStart(30, "0")}`, at })),
    "p",
  )
  assert.ok(long.length <= 300 && long.includes("#"))
})

test("the reason in the document's language, at most 256 characters", () => {
  assert.equal(correctionReasonText(["return", "refund"], "pl", "1042"), "Zwrot towaru, Obniżenie ceny po sprzedaży (zamówienie 1042)")
  assert.equal(correctionReasonText(["cancel"], "en", null), "Order canceled")
  assert.equal(correctionReasonText([], "pl/en", null), "Zmiana zamówienia")
})

const ORIGINAL = {
  id: 600000001,
  kind: "vat",
  oid: "1042",
  currency: "PLN",
  lang: "pl",
  department_id: 101,
  place: "Warszawa",
  payment_type: "card",
  sell_date: "2026-10-05",
  buyer_name: "Firma sp. z o.o.",
  buyer_company: "1",
  buyer_tax_no: "1234563218",
  buyer_email: "biuro@firma.pl",
  buyer_city: "Kraków",
  description: "not copied",
  positions: [
    { id: 9000, name: "Krem nawilżający, 50 ml", code: "KREM-50", quantity: "2.0", total_price_gross: "123.0", tax: "23" },
    { id: 9001, name: "InPost Paczkomat", quantity: "1.0", total_price_gross: "20.0", tax: "23" },
  ],
}

test("the correction as documented: kind, reason, the corrected invoice, positions with before and after", () => {
  const v = planCorrection(input({ order: returned(1) as never }))
  if (v.kind === "none") throw new Error("expected a plan")
  const invoice = buildCorrectionInvoice(ORIGINAL, v.positions, {
    originalId: "600000001",
    today: "2026-10-06",
    reason: "Zwrot towaru (zamówienie 1042)",
    rowId: "fkdoc_7",
    orderLabel: "#1042",
    fallback: { lang: "pl", issuePlace: "", currency: "PLN", oid: "1042" },
  })
  assert.deepEqual(
    [invoice.kind, invoice.correction_reason, invoice.invoice_id, invoice.from_invoice_id, invoice.issue_date, invoice.sell_date],
    ["correction", "Zwrot towaru (zamówienie 1042)", 600000001, 600000001, "2026-10-06", "2026-10-05"],
  )
  assert.equal(invoice.oid_unique, undefined, "the corrected invoice carries the same order number")
  assert.equal(invoice.description, undefined)
  assert.deepEqual([invoice.department_id, invoice.buyer_company, invoice.buyer_tax_no, invoice.buyer_email], [101, true, "1234563218", "biuro@firma.pl"])
  assert.match(String(invoice.internal_note), /\[medusa:fkdoc_7\]/)
  assert.deepEqual((invoice.positions as unknown[])[0], {
    name: "Krem nawilżający, 50 ml",
    code: "KREM-50",
    tax: 23,
    quantity_unit: "szt.",
    quantity: -1,
    total_price_gross: -61.5,
    kind: "correction",
    correction_before_attributes: { name: "Krem nawilżający, 50 ml", code: "KREM-50", tax: 23, quantity_unit: "szt.", quantity: 2, total_price_gross: 123, kind: "correction_before" },
    correction_after_attributes: { name: "Krem nawilżający, 50 ml", code: "KREM-50", tax: 23, quantity_unit: "szt.", quantity: 1, total_price_gross: 61.5, kind: "correction_after" },
  })
  assert.throws(() => buildCorrectionInvoice(ORIGINAL, [], { originalId: "1", today: "x", reason: "r", rowId: "r", orderLabel: "#1", fallback: { lang: "pl", issuePlace: "", currency: "PLN", oid: null } }), PayloadError)
})

test("before sending: the invoice in Fakturownia must still hold what the plugin issued", () => {
  assert.equal(originalMismatch(ISSUED, ORIGINAL.positions), null)
  assert.match(originalMismatch(ISSUED, [ORIGINAL.positions[0]]) ?? "", /InPost Paczkomat/)
  assert.match(originalMismatch(ISSUED, [{ ...ORIGINAL.positions[0], quantity: "3" }, ORIGINAL.positions[1]]) ?? "", /is 3 for/)
  assert.match(originalMismatch(ISSUED, [...ORIGINAL.positions, { name: "Extra", quantity: 1, total_price_gross: 5, tax: 23 }]) ?? "", /Extra/)
  assert.ok(originalMismatch(ISSUED, null))
})

const candidate = (over: Partial<CorrectionCandidate> = {}): CorrectionCandidate => ({
  id: "700",
  number: "KOR 1/10/2026",
  kind: "correction",
  oid: "1042",
  gross: -61.5,
  currency: "PLN",
  issueDate: "2026-10-06",
  fromInvoiceId: "600000001",
  invoiceId: "600000001",
  internalNote: null,
  ...over,
})
const SPEC = { originalId: "600000001", marker: correctionMarker("fkdoc_7"), totalGross: -61.5, currency: "PLN", notBefore: "2026-09-29", excludeIds: [] as string[] }

test("our correction: by its marker first, otherwise the only one of the same value nobody owns", () => {
  assert.equal(matchCorrection([candidate({ internalNote: "Medusa #1042 [medusa:fkdoc_7]", gross: -1 })], SPEC).kind, "match", "the marker wins over the value")
  assert.equal(matchCorrection([candidate()], SPEC).kind, "match")
  assert.equal(matchCorrection([candidate({ gross: -20 })], SPEC).kind, "none", "another value is someone else's correction")
  assert.equal(matchCorrection([candidate({ internalNote: "[medusa:fkdoc_9]" })], SPEC).kind, "none", "another row's correction")
  assert.equal(matchCorrection([candidate()], { ...SPEC, excludeIds: ["700"] }).kind, "none", "owned by another row")
  assert.equal(matchCorrection([candidate({ fromInvoiceId: "5", invoiceId: "5" })], SPEC).kind, "none", "a correction of another invoice")
  assert.equal(matchCorrection([candidate({ kind: "vat" })], SPEC).kind, "none")
  assert.equal(matchCorrection([candidate({ issueDate: "2025-01-01" })], SPEC).kind, "none")
  const twins = matchCorrection([candidate(), candidate({ id: "701", number: "KOR 2/10/2026" })], SPEC)
  assert.equal(twins.kind, "conflict")
  assert.match(twins.kind === "conflict" ? twins.reason : "", /KOR 1\/10\/2026, KOR 2\/10\/2026/)
})
