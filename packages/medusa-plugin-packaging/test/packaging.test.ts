import { test } from "node:test"
import assert from "node:assert/strict"
import { formatSscc, gs1Check, makeSscc, satisfiesMoq, splitQuantity, ssccPayload } from "../src/modules/packaging/lib/packaging.ts"

test("packaging: the GS1 check digit follows the 3/1 weights", () => {
  assert.equal(gs1Check("590123412345"), "7", "the canonical GTIN example")
  assert.equal(gs1Check("0"), "0")
})

test("packaging: an SSCC is 18 digits and consistent with its check digit", () => {
  const sscc = makeSscc("590123456789", "42")
  assert.equal(sscc.length, 18)
  assert.match(sscc, /^\d{18}$/)
  assert.equal(sscc.slice(17), gs1Check(sscc.slice(0, 17)))
  assert.match(formatSscc(sscc), /^\d{3} \d{4} \d{5} \d{5} \d$/)
})

test("packaging: the GS1-128 payload carries the AI and its check digit", () => {
  const payload = ssccPayload(makeSscc("590123456789", "1"))
  assert.match(payload, /^00\d{18}\d$/)
})

test("packaging: a quantity splits into pallets, boxes and pieces", () => {
  const ladder = [
    { name: "szt.", pieces: 1 },
    { name: "karton", pieces: 12 },
    { name: "paleta", pieces: 120 },
  ]
  assert.deepEqual(splitQuantity(48, ladder), [{ name: "karton", pieces: 12, count: 4 }])
  assert.deepEqual(splitQuantity(134, ladder), [
    { name: "paleta", pieces: 120, count: 1 },
    { name: "karton", pieces: 12, count: 1 },
    { name: "szt.", pieces: 1, count: 2 },
  ])
  assert.deepEqual(splitQuantity(0, ladder), [{ name: "szt.", pieces: 1, count: 0 }])
})

test("packaging: the MOQ and the step rule", () => {
  assert.equal(satisfiesMoq(24, 12, 12), true)
  assert.equal(satisfiesMoq(10, 12, 0), false)
  assert.equal(satisfiesMoq(18, 12, 12), false, "18 is below the step of 12")
  assert.equal(satisfiesMoq(120, 0, 0), true, "no MOQ takes anything")
})
