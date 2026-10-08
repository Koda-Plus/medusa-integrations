import { test } from "node:test"
import assert from "node:assert/strict"
import { completeOf, toConsent, toDsr, toProductCompliance, toResponsiblePerson } from "../src/modules/compliance/lib/store.ts"

test("store: a responsible person maps with cleaned fields and the kind kept", () => {
  const dto = toResponsiblePerson({ id: "crp_1", kind: "manufacturer", name: " Maker GmbH ", address: null, email: " mail@example.com ", country_code: "de", demo: true })
  assert.equal(dto.kind, "manufacturer")
  assert.equal(dto.name, "Maker GmbH")
  assert.equal(dto.email, "mail@example.com")
  assert.equal(dto.address, null)
  assert.equal(dto.country_code, "de")
  assert.equal(dto.demo, true)
})

test("store: an unknown kind reads as responsible person", () => {
  assert.equal(toResponsiblePerson({ id: "crp_1", kind: "seller", name: "X" }).kind, "responsible_person")
})

test("store: a GPSR record is complete only with both ids", () => {
  assert.equal(completeOf({ manufacturer_id: "m", responsible_person_id: "r" }), true)
  assert.equal(completeOf({ manufacturer_id: "m" }), false)
  assert.equal(completeOf({ responsible_person_id: "r" }), false)
  assert.equal(completeOf({}), false)
})

test("store: warnings map to an array of strings, completeness follows the ids", () => {
  const dto = toProductCompliance({ id: "cpr_1", product_id: "prod_1", sku: "KS-1", title: "Tool", manufacturer_id: "m", responsible_person_id: "r", warnings: ["w1", 42, " w2 "], safety_info: null, demo: false })
  assert.deepEqual(dto.warnings, ["w1", " w2 "])
  assert.equal(dto.complete, true)
  assert.equal(dto.product_id, "prod_1")
})

test("store: consent maps defaults and booleans", () => {
  const c = toConsent({ id: "ccn_1", purpose: "marketing", granted: true, source: undefined, demo: false, created_at: "2026-01-01T00:00:00.000Z" })
  assert.equal(c.purpose, "marketing")
  assert.equal(c.granted, true)
  assert.equal(c.source, "cookie_banner")
  assert.equal(c.customer_id, null)
  assert.equal(c.created_at, "2026-01-01T00:00:00.000Z")
})

test("store: a DSR maps its type and status and formats dates", () => {
  const d = toDsr({ id: "cdsr_1", customer_id: "cus_1", type: "erasure", status: "pending", created_at: new Date("2026-01-01T00:00:00Z") })
  assert.equal(d.type, "erasure")
  assert.equal(d.status, "pending")
  assert.equal(d.created_at, "2026-01-01T00:00:00.000Z")
  assert.equal(toDsr({ id: "cdsr_2", customer_id: "cus_1", type: "unknown", status: "unknown" }).type, "access")
})
