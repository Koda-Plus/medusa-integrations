import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanNip, countryOf, kindOf, sourceOf, stateFromMfStatus, stateFromVies, validNipChecksum } from "../src/modules/whitelist/lib/whitelist.ts"
import { demoAnswer } from "../src/modules/whitelist/lib/check.ts"

test("whitelist: a NIP cleans to its digits only with a valid checksum", () => {
  assert.equal(cleanNip(" 123-456-32-18 "), "1234563218")
  assert.equal(cleanNip("1234563210"), null)
  assert.equal(cleanNip("12345"), null)
  assert.equal(validNipChecksum("1234563218"), true)
  assert.equal(validNipChecksum("1234563219"), false)
})

test("whitelist: the kind tells a Polish NIP from an EU VAT number", () => {
  assert.equal(kindOf("1234563218"), "nip")
  assert.equal(kindOf("DE123456789"), "vat")
  assert.equal(kindOf("PL1234567890"), "vat")
  assert.equal(kindOf("abc"), null)
  assert.equal(kindOf(""), null)
  assert.equal(countryOf("DE123456789"), "DE")
  assert.equal(countryOf("1234563218"), "PL")
  assert.equal(sourceOf("1234563218"), "whitelist")
  assert.equal(sourceOf("DE123456789"), "vies")
})

test("whitelist: the registry answers map to the module states", () => {
  assert.equal(stateFromMfStatus("Czynny"), "active")
  assert.equal(stateFromMfStatus("Zwolniony"), "exempt")
  assert.equal(stateFromMfStatus("Niezarejestrowany"), "not_found")
  assert.equal(stateFromMfStatus("cos innego"), "unavailable")
  assert.equal(stateFromVies(true), "active")
  assert.equal(stateFromVies(false), "not_found")
})

test("whitelist: the demo answers come from the sample tables", () => {
  const active = demoAnswer("1234563218")
  assert.equal(active.state, "active")
  assert.equal(active.status_vat, "Czynny")
  assert.equal(active.bank_accounts.length, 1)
  const exempt = demoAnswer("0123456789")
  assert.equal(exempt.state, "exempt")
  const missing = demoAnswer("1111111111")
  assert.equal(missing.state, "not_found")
  const vat = demoAnswer("DE123456789")
  assert.equal(vat.state, "active")
  assert.equal(vat.country_code, "DE")
  const badVat = demoAnswer("DE999999999")
  assert.equal(badVat.state, "not_found")
})

test("whitelist: a number that does not validate reads not found in the demo table", () => {
  /* In the real flow checkNumber answers invalid before the demo table is asked. */
  const other = demoAnswer("5260001241")
  assert.equal(other.state, "not_found")
})

test("whitelist: a known company answers with its real public registry data", () => {
  const pko = demoAnswer("525-000-77-38")
  assert.equal(pko.state, "active")
  assert.equal(pko.name, "Powszechna Kasa Oszczędności Bank Polski S.A.")
  assert.equal(pko.krs, "0000026438")
  assert.ok((pko.bank_accounts ?? []).length >= 1)
})

test("whitelist: the demo card never throws, whatever the sign of the hash (regression)", () => {
  /* Hashes above 2^31 used to shift to a negative index and throw. */
  for (const nip of ["895-230-52-60", "999-999-99-99", "774-00-01-454"]) {
    const a = demoAnswer(nip)
    assert.ok(a.name && a.name.length > 0, `${nip} got a name`)
    assert.ok(a.address && a.address.includes("ul."), `${nip} got an address`)
    assert.ok(a.regon && /^\d{9}$/.test(a.regon))
    assert.ok(a.krs && /^\d{10}$/.test(a.krs))
  }
})
