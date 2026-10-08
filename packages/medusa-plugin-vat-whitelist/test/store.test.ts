import { test } from "node:test"
import assert from "node:assert/strict"
import { toCheck, toEntity } from "../src/modules/whitelist/lib/store.ts"

test("store: an entity maps with its state and accounts, stale by the hours", () => {
  const fresh = toEntity(
    { id: "wen_1", nip: "1234563218", country_code: "PL", source: "whitelist", state: "active", status_vat: "Czynny", name: " Firma ", address: null, bank_accounts: ["61109010140000071219812874", 42], customer_id: "cus_1", checked_at: new Date(), demo: true },
    24,
  )
  assert.equal(fresh.name, "Firma")
  assert.equal(fresh.state, "active")
  assert.deepEqual(fresh.bank_accounts, ["61109010140000071219812874"])
  assert.equal(fresh.customer_id, "cus_1")
  assert.equal(fresh.stale, false)
  const stale = toEntity({ id: "wen_2", nip: "1234563218", state: "active", checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }, 24)
  assert.equal(stale.stale, true)
})

test("store: unknown states and sources read their defaults", () => {
  assert.equal(toEntity({ id: "wen_1", nip: "1234563218", state: "cos", checked_at: new Date() }, 24).state, "unavailable")
  assert.equal(toEntity({ id: "wen_1", nip: "1234563218", source: "cos", checked_at: new Date() }, 24).source, "whitelist")
})

test("store: a check maps with the requestor and the date", () => {
  const c = toCheck({ id: "wch_1", entity_id: "wen_1", nip: "1234563218", source: "vies", state: "exempt", requested_by: "admin", created_at: new Date("2026-01-01T00:00:00Z") })
  assert.equal(c.source, "vies")
  assert.equal(c.state, "exempt")
  assert.equal(c.requested_by, "admin")
  assert.equal(c.created_at, "2026-01-01T00:00:00.000Z")
})
