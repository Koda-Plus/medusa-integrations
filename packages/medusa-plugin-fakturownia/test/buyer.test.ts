import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanTaxId, findTaxId, isValidNip, mapBuyer } from "../src/modules/fakturownia/lib/buyer.ts"
import { order } from "./helpers.ts"

const KEYS = ["nip", "tax_id", "invoice_nip"]

test("NIP cleaning: digits only, the PL prefix stripped, foreign VAT numbers kept", () => {
  assert.equal(cleanTaxId("PL 123-456-32-18"), "1234563218")
  assert.equal(cleanTaxId("123 456 32 18"), "1234563218")
  assert.equal(cleanTaxId("pl1234563218"), "1234563218")
  assert.equal(cleanTaxId("NIP: 123-456-32-18"), "1234563218")
  assert.equal(cleanTaxId("DE123456789"), "DE123456789")
  assert.equal(cleanTaxId("ATU12345678"), "ATU12345678")
  assert.equal(cleanTaxId(1234563218), "1234563218")
  assert.equal(cleanTaxId("brak"), null)
  assert.equal(cleanTaxId("   "), null)
  assert.equal(cleanTaxId(null), null)
})

test("NIP checksum (informational)", () => {
  assert.equal(isValidNip("1234563218"), true)
  assert.equal(isValidNip("1234563219"), false)
  assert.equal(isValidNip("123"), false)
})

test("the tax ID: order metadata first, then billing address metadata, then a billing tax_id field", () => {
  assert.equal(findTaxId(order({ metadata: { invoice_nip: "PL1234563218" } }) as never, KEYS), "1234563218")
  const o = order({ billing_address: { ...order().billing_address, metadata: { nip: "0123456789" } } })
  assert.equal(findTaxId(o as never, KEYS), "0123456789")
  const field = order({ billing_address: { ...order().billing_address, tax_id: "012-345-67-89" } })
  assert.equal(findTaxId(field as never, KEYS), "0123456789")
  assert.equal(findTaxId(order({ metadata: { vat_id: "0123456789" } }) as never, KEYS), null, "only the configured keys")
  assert.equal(findTaxId(order({ metadata: { vat_id: "0123456789" } }) as never, ["vat_id"]), "0123456789")
})

test("a buyer with a tax ID is a company: the billing company name, the NIP, buyer_company true", () => {
  const o = order({ metadata: { nip: "123-456-32-18" }, billing_address: { ...order().billing_address, company: "Salon Urody Anna sp. z o.o." } })
  const b = mapBuyer(o as never, KEYS)
  assert.equal(b.type, "company")
  assert.equal(b.taxId, "1234563218")
  assert.deepEqual(b.fields, {
    buyer_company: true,
    buyer_name: "Salon Urody Anna sp. z o.o.",
    buyer_tax_no: "1234563218",
    buyer_street: "ul. Długa 5 m. 3",
    buyer_post_code: "00-001",
    buyer_city: "Warszawa",
    buyer_country: "PL",
    buyer_email: "anna@example.com",
  })
  assert.equal("buyer_first_name" in b.fields, false)
})

test("a company without a company name on the address takes it from metadata, then the person's name", () => {
  const meta = mapBuyer(order({ metadata: { nip: "1234563218", invoice_company: "Firma z metadanych" } }) as never, KEYS)
  assert.equal(meta.fields.buyer_name, "Firma z metadanych")
  const named = mapBuyer(order({ metadata: { nip: "1234563218" } }) as never, KEYS)
  assert.equal(named.fields.buyer_name, "Anna Nowak")
  assert.equal(named.fields.buyer_company, true)
})

test("a buyer without a tax ID is a person: first and last name, buyer_company false", () => {
  const b = mapBuyer(order() as never, KEYS)
  assert.equal(b.type, "person")
  assert.equal(b.taxId, null)
  assert.equal(b.fields.buyer_company, false)
  assert.equal(b.fields.buyer_name, "Anna Nowak")
  assert.equal(b.fields.buyer_first_name, "Anna")
  assert.equal(b.fields.buyer_last_name, "Nowak")
  assert.equal(b.fields.buyer_tax_no, undefined)
})

test("the address comes from billing, or from shipping when billing is empty", () => {
  const b = mapBuyer(
    order({
      billing_address: null,
      shipping_address: { first_name: "Jan", last_name: "Kowalski", address_1: "ul. Krótka 1", postal_code: "30-001", city: "Kraków", country_code: "pl" },
    }) as never,
    KEYS,
  )
  assert.equal(b.fields.buyer_name, "Jan Kowalski")
  assert.equal(b.fields.buyer_street, "ul. Krótka 1")
  assert.equal(b.fields.buyer_city, "Kraków")
  const nothing = mapBuyer({ email: "x@example.com" }, KEYS)
  assert.equal(nothing.fields.buyer_name, "x@example.com")
  assert.equal(nothing.fields.buyer_street, undefined)
})
