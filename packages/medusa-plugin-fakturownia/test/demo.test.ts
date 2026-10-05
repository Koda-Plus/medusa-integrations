import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEMO_ID_BASE,
  demoFailingOrder,
  demoGovId,
  demoGovStatus,
  demoKsefMinutes,
  demoNumber,
  demoPaid,
  hash32,
  nextDemoId,
} from "../src/modules/fakturownia/lib/demo.ts"

test("the hash is stable across runs (FNV-1a), so a restart does not reshuffle the demo", () => {
  assert.equal(hash32(""), 0x811c9dc5)
  assert.equal(hash32("order_1"), hash32("order_1"))
  assert.notEqual(hash32("order_1"), hash32("order_2"))
})

test("numbers per kind: FV, PRO and PAR with the sequence, the month and the year", () => {
  assert.equal(demoNumber("vat", 12, "2026-10-05"), "FV 12/10/2026")
  assert.equal(demoNumber("proforma", 3, "2026-10-05"), "PRO 3/10/2026")
  assert.equal(demoNumber("receipt", 7, "2027-01-02"), "PAR 7/01/2027")
  assert.equal(demoNumber("vat", 0, "2026-10-05"), "FV 1/10/2026")
})

test("simulated ids follow the highest one given out", () => {
  assert.equal(nextDemoId(null), DEMO_ID_BASE + 1)
  assert.equal(nextDemoId(DEMO_ID_BASE + 41), DEMO_ID_BASE + 42)
  assert.equal(nextDemoId(17), DEMO_ID_BASE + 1)
})

test("paid: always when captured, about a third of the others, the same answer every time", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `order_${i}`)
  assert.ok(ids.every((id) => demoPaid(id, true)))
  const paid = ids.filter((id) => demoPaid(id, false)).length
  assert.ok(paid > 60 && paid < 140, `${paid} of 300`)
  assert.deepEqual(
    ids.map((id) => demoPaid(id, false)),
    ids.map((id) => demoPaid(id, false)),
  )
})

test("KSeF: a VAT invoice is processing, then accepted two to eight minutes later; other kinds are not in KSeF", () => {
  const issuedAt = new Date("2026-10-05T10:00:00Z")
  const minutes = demoKsefMinutes("order_1")
  assert.ok([2, 3, 4, 6, 8].includes(minutes))
  const at = (m: number) => demoGovStatus({ kind: "vat", orderId: "order_1", issuedAt, now: new Date(issuedAt.getTime() + m * 60_000) })
  assert.equal(at(0), "processing")
  assert.equal(at(minutes - 0.5), "processing")
  assert.equal(at(minutes), "ok")
  assert.equal(demoGovStatus({ kind: "proforma", orderId: "order_1", issuedAt, now: issuedAt }), "not_applicable")
  assert.equal(demoGovStatus({ kind: "receipt", orderId: "order_1", issuedAt, now: issuedAt }), "not_applicable")
  const paces = new Set(Array.from({ length: 50 }, (_, i) => demoKsefMinutes(`order_${i}`)))
  assert.ok(paces.size >= 3, "not every invoice is accepted at the same moment")
})

test("KSeF numbers have the real shape and an obviously fake NIP, stable per order", () => {
  const id = demoGovId("order_1", "2026-10-05")
  assert.match(id, /^0000000000-20261005-[0-9A-F]{12}$/)
  assert.equal(demoGovId("order_1", "2026-10-05"), id)
})

test("the failing demo document is chosen by hash: the same order whatever the list order, none for tiny stores", () => {
  const ids = ["order_a", "order_b", "order_c", "order_d", "order_e"]
  const failing = demoFailingOrder(ids)
  assert.ok(failing && ids.includes(failing))
  assert.equal(demoFailingOrder([...ids].reverse()), failing)
  assert.equal(demoFailingOrder(["order_a", "order_b"]), null)
})
