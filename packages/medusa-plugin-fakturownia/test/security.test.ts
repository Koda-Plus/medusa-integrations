import { test } from "node:test"
import assert from "node:assert/strict"
import { maskSecrets, tokenState } from "../src/modules/fakturownia/lib/security.ts"

const TOKEN = "fkTEST0123456789abcdefGHIJ/mojafirma"

test("masking: the token literally, and its part before the account suffix", () => {
  const out = maskSecrets(`token ${TOKEN} and the bare part fkTEST0123456789abcdefGHIJ echoed`, [TOKEN])
  assert.ok(!out.includes(TOKEN))
  assert.ok(!out.includes("fkTEST0123456789abcdefGHIJ"))
  assert.equal(out, "token *** and the bare part *** echoed")
})

test("masking: api_token in a query string or a JSON body, and Bearer headers", () => {
  const out = maskSecrets(
    'GET /invoices/1.json?api_token=someOtherToken123&kind=vat {"api_token": "anotherOne456"} Authorization: Bearer xyzSECRET789',
    [],
  )
  assert.ok(!out.includes("someOtherToken123"))
  assert.ok(!out.includes("anotherOne456"))
  assert.ok(!out.includes("xyzSECRET789"))
  assert.ok(out.includes("kind=vat"), "the rest of the query stays readable")
})

test("masking: long token-like runs go, readable ids, numbers and KSeF numbers stay", () => {
  const other = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4"
  const out = maskSecrets(
    `other ${other}, order order_01JDEMO0000000000000000001, FV 12/10/2026, NIP 1234563218, KSeF 1234563218-20260201-ABC123DEF456`,
    [null, undefined, ""],
  )
  assert.ok(!out.includes(other))
  for (const keep of ["order_01JDEMO0000000000000000001", "FV 12/10/2026", "1234563218", "1234563218-20260201-ABC123DEF456"]) assert.ok(out.includes(keep), keep)
})

test("masking: short configured values are never used as needles", () => {
  assert.equal(maskSecrets("price 100 PLN", ["100"]), "price 100 PLN")
})

test("the admin learns only whether the token is set", () => {
  assert.equal(tokenState(TOKEN), "set")
  assert.equal(tokenState("  "), "missing")
  assert.equal(tokenState(undefined), "missing")
})
