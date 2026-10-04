import { test } from "node:test"
import assert from "node:assert/strict"
import { matchesPrefix, methodLabel, paymentState, readyForSubiekt, type PaymentCollectionRecord } from "../src/modules/subiekt/lib/payment.ts"
import { DEFAULT_COD_PROVIDERS, DEFAULT_PREPAID_PROVIDERS } from "../src/modules/subiekt/lib/constants.ts"

const state = (collections: PaymentCollectionRecord[], totalGross = 100, dueDays: number | null = null) =>
  paymentState({ collections, totalGross, prepaidProviders: DEFAULT_PREPAID_PROVIDERS, codProviders: DEFAULT_COD_PROVIDERS, dueDays })

test("a card payment that is not captured yet keeps the ZK waiting", () => {
  const s = state([{ status: "authorized", payments: [{ provider_id: "pp_stripe_stripe", amount: 100 }] }])
  assert.equal(s.prepaid, true)
  assert.equal(s.status, "awaiting")
  assert.equal(readyForSubiekt(s), false)
})

test("a captured card payment releases the ZK", () => {
  const s = state([{ status: "completed", payments: [{ provider_id: "pp_stripe-blik_stripe", amount: 100, captured_at: "2026-10-04T10:00:00Z" }] }])
  assert.equal(s.status, "captured")
  assert.equal(s.method, "BLIK (Stripe)")
  assert.equal(s.capturedAt, "2026-10-04T10:00:00.000Z")
  assert.equal(readyForSubiekt(s), true)
})

test("captures add up, partial capture is not enough", () => {
  const partial = state([{ payments: [{ provider_id: "pp_p24_p24", amount: 100, captures: [{ amount: 40 }] }] }])
  assert.equal(partial.status, "awaiting")
  assert.equal(partial.amountPaid, 40)
  assert.equal(readyForSubiekt(partial), false)
  const full = state([{ payments: [{ provider_id: "pp_p24_p24", amount: 100, captures: [{ amount: 40 }, { amount: "60.00", created_at: "2026-10-04T11:00:00Z" }] }] }])
  assert.equal(full.status, "captured")
  assert.equal(full.capturedAt, "2026-10-04T11:00:00.000Z")
})

test("cash on delivery, bank transfer and manual payments go at once", () => {
  const cod = state([{ payments: [{ provider_id: "pp_cod_cod", amount: 100 }] }])
  assert.equal(cod.status, "cash_on_delivery")
  assert.equal(readyForSubiekt(cod), true)
  const manual = state([{ payments: [{ provider_id: "pp_system_default", amount: 100 }] }])
  assert.equal(manual.status, "awaiting")
  assert.equal(manual.method, "Manual payment")
  assert.equal(readyForSubiekt(manual), true)
  const credit = state([{ payments: [{ provider_id: "pp_system_default", amount: 100 }] }], 100, 14)
  assert.equal(credit.method, "Bank transfer, 14 days")
  assert.equal(credit.dueDays, 14)
})

test("canceled payments and collections do not count", () => {
  const s = state([
    { status: "canceled", payments: [{ provider_id: "pp_stripe_stripe", amount: 100, captured_at: "2026-10-04T09:00:00Z" }] },
    { payments: [{ provider_id: "pp_stripe_stripe", amount: 100, captured_at: "2026-10-04T09:00:00Z", canceled_at: "2026-10-04T09:05:00Z" }] },
  ])
  assert.equal(s.amountPaid, 0)
  assert.equal(s.status, "awaiting")
})

test("a free order needs no payment", () => {
  const s = state([], 0)
  assert.equal(s.status, "not_required")
  assert.equal(readyForSubiekt(s), true)
})

test("prefixes match case-insensitively and only at the start", () => {
  assert.equal(matchesPrefix("PP_STRIPE_stripe", ["pp_stripe"]), true)
  assert.equal(matchesPrefix("pp_mystripe", ["pp_stripe"]), false)
  assert.equal(matchesPrefix(null, ["pp_stripe"]), false)
  assert.equal(matchesPrefix("pp_x", [" ", ""]), false)
  assert.equal(methodLabel("pp_unknown_provider"), "pp_unknown_provider")
  assert.equal(methodLabel(null), null)
})
