import { test } from "node:test"
import assert from "node:assert/strict"
import { bankName, brandName, classifyDetails, classifyPaymentIntent, describeDetail, methodOfType } from "../src/modules/stripe/lib/methods.ts"
import { pi } from "./fixtures.ts"

test("charges: wallets are split out of cards, BLIK and Przelewy24 by their type", () => {
  assert.equal(classifyDetails({ type: "card", card: { brand: "visa", last4: "4242", wallet: { type: "apple_pay" } } })?.method, "apple_pay")
  assert.equal(classifyDetails({ type: "card", card: { brand: "mastercard", last4: "4444", wallet: { type: "google_pay" } } })?.method, "google_pay")
  assert.equal(classifyDetails({ type: "card", card: { brand: "visa", last4: "4242", wallet: { type: "link" } } })?.method, "link")
  assert.equal(classifyDetails({ type: "card", card: { brand: "visa", last4: "4242", wallet: { type: "samsung_pay" } } })?.method, "card")
  const card = classifyDetails({ type: "card", card: { brand: "visa", last4: "4242", wallet: null } })
  assert.deepEqual(card, { method: "card", detail: { brand: "visa", last4: "4242", wallet: null, bank: null, reference: null, type: "card" } })
  assert.equal(classifyDetails({ type: "blik", blik: {} })?.method, "blik")
  const p24 = classifyDetails({ type: "p24", p24: { bank: "pbac_z_ipko", reference: "P24-ABC-DEF-GHI" } })
  assert.equal(p24?.method, "p24")
  assert.equal(p24?.detail.bank, "pbac_z_ipko")
  assert.equal(p24?.detail.reference, "P24-ABC-DEF-GHI")
  assert.equal(classifyDetails({ type: "link" })?.method, "link")
  assert.deepEqual(classifyDetails({ type: "klarna" })?.method, "other")
  assert.equal(classifyDetails({ type: "klarna" })?.detail.type, "klarna")
  assert.equal(classifyDetails(null), null)
  assert.equal(classifyDetails({}), null)
})

test("PaymentIntents: the charge first, then the declined attempt, then a single allowed type", () => {
  assert.equal(classifyPaymentIntent(pi({ amount: 1000, method: { type: "p24" } }))?.method, "p24")
  const failed = pi({ amount: 1000, status: "requires_payment_method", error: { method: { type: "card" } } })
  failed.latest_charge = null
  assert.equal(classifyPaymentIntent(failed)?.method, "card")
  /* The BLIK provider of Medusa creates intents for one type, without automatic methods. */
  const blik = pi({ amount: 1000, status: "requires_payment_method", automatic: false, types: ["blik"] })
  assert.equal(classifyPaymentIntent(blik)?.method, "blik")
  /* An automatic intent nobody paid yet has no method. */
  const open = pi({ amount: 1000, status: "requires_payment_method" })
  assert.equal(classifyPaymentIntent(open), null)
  /* An expanded payment method of an intent waiting for the customer. */
  const waiting = pi({ amount: 1000, status: "requires_action" })
  waiting.payment_method = { id: "pm_Fixture", type: "blik" }
  assert.equal(classifyPaymentIntent(waiting)?.method, "blik")
})

test("types alone", () => {
  assert.equal(methodOfType("card"), "card")
  assert.equal(methodOfType("p24"), "p24")
  assert.equal(methodOfType("sepa_debit"), "other")
  assert.equal(methodOfType(null), null)
})

test("names of banks and brands, unknown values humanized", () => {
  assert.equal(bankName("pbac_z_ipko"), "PKO Bank Polski")
  assert.equal(bankName("mbank_mtransfer"), "mBank")
  assert.equal(bankName("some_new_bank"), "Some New Bank")
  assert.equal(bankName(null), null)
  assert.equal(brandName("visa"), "Visa")
  assert.equal(brandName("amex"), "American Express")
  assert.equal(brandName("unknown"), null)
  assert.equal(describeDetail({ brand: "visa", last4: "4242", wallet: null, bank: null, reference: null, type: "card" }), "Visa 4242")
  assert.equal(describeDetail({ brand: null, last4: null, wallet: null, bank: "ing", reference: "P24-1", type: "p24" }), "ING Bank Śląski, P24-1")
  assert.equal(describeDetail(null), "")
})
