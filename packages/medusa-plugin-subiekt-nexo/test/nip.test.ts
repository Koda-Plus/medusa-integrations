import { test } from "node:test"
import assert from "node:assert/strict"
import { companyWithoutNip, findNip, formatNip, isValidNip, nipsInText, normalizeNip } from "../src/modules/subiekt/lib/nip.ts"
import { DEFAULT_NIP_SOURCES } from "../src/modules/subiekt/lib/constants.ts"

test("the NIP checksum: weights 6 5 7 2 3 4 5 6 7, a remainder of 10 is never valid", () => {
  assert.equal(isValidNip("1234563218"), true)
  assert.equal(isValidNip("PL 123-456-32-18"), true)
  assert.equal(isValidNip("123.456.32.18"), true)
  assert.equal(isValidNip("1234563219"), false)
  assert.equal(isValidNip("0000000000"), false)
  assert.equal(isValidNip("5265877635"), true)
  // 1..9 weighted gives 230, 230 mod 11 = 10: no tenth digit makes it valid.
  for (let d = 0; d <= 9; d++) assert.equal(isValidNip(`123456789${d}`), false)
  assert.equal(isValidNip("DE123456789"), false)
  assert.equal(isValidNip(null), false)
})

test("normalizing keeps digits only when the rest is separators", () => {
  assert.equal(normalizeNip(" PL1234563218 "), "1234563218")
  assert.equal(normalizeNip("123 456 32 18"), "1234563218")
  assert.equal(normalizeNip("NIP 1234563218"), null)
  assert.equal(normalizeNip("12345"), null)
  assert.equal(formatNip("1234563218"), "123-456-32-18")
})

test("a NIP is found inside free text, and only where digits stand on their own", () => {
  assert.deepEqual(nipsInText("Salon Ania sp. z o.o., NIP 123-456-32-18"), ["1234563218"])
  assert.deepEqual(nipsInText("NIP: PL5265877635 / tel. 600 000 000"), ["5265877635"])
  assert.deepEqual(nipsInText("konto 12345678901234567890"), [])
  assert.deepEqual(nipsInText(null), [])
  assert.equal(companyWithoutNip("Salon Ania sp. z o.o., NIP 123-456-32-18"), "Salon Ania sp. z o.o.")
  assert.equal(companyWithoutNip("ACME"), "ACME")
  assert.equal(companyWithoutNip("NIP 1234563218"), null)
})

test("nipSources: metadata first, a wrong NIP in a NIP field decides, free text needs the checksum", () => {
  const sources = DEFAULT_NIP_SOURCES
  assert.deepEqual(findNip({ metadata: { nip: "123-456-32-18" } }, sources), { nip: "1234563218", source: "metadata.nip", invalid: null })
  assert.deepEqual(findNip({ metadata: { nip: "123-456-32-19" }, billing_address: { company: "X, NIP 5265877635" } }, sources), {
    nip: null,
    source: "metadata.nip",
    invalid: { source: "metadata.nip", value: "123-456-32-19" },
  })
  assert.equal(findNip({ billing_address: { company: "Salon Ania, NIP 123-456-32-18" } }, sources).nip, "1234563218")
  assert.equal(findNip({ billing_address: { metadata: { tax_id: "PL1234563218" } } }, sources).source, "billing_address.metadata.tax_id")
  assert.deepEqual(findNip({ billing_address: { company: "Firma 123-456-32-19" } }, sources).invalid, { source: "billing_address.company", value: "1234563219" })
  assert.deepEqual(findNip({}, sources), { nip: null, source: null, invalid: null })
  assert.equal(findNip({ metadata: { nip: "1234563218" } }, []).nip, null)
})
