/**
 * Several codes in one e-mail: the coupons of a send (the one of the
 * address first, at most five, each with its own sentence), per person the
 * codes she did not get before, the rows each coupon keeps (a shared
 * campaign id, every code of her e-mail) and the results that name the
 * other codes of the same e-mail. One code stays exactly as before.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { COUPONS_PER_SEND_MAX, campaignIdOf, cleanSendCoupons, codeSentOf, planMultiSend, planSend, sentEntry, withSent } from "../src/modules/coupons/lib/code-mail.ts"
import { codeMailCampaigns } from "../src/modules/coupons/lib/code-mail-stats.ts"
import type { CodeSentEntry } from "../src/modules/coupons/lib/contract.ts"

const AT = "2026-11-01T10:00:00.000Z"
const sent = (customer_id: string, extra: Partial<CodeSentEntry> = {}): CodeSentEntry => ({ customer_id, email: `${customer_id}@example.com`, at: AT, by: "biuro", ...extra })

test("one coupon: its sentence is the message, nothing else is asked for", () => {
  assert.deepEqual(cleanSendCoupons("promo_a", undefined, "10% na wszystko"), { ok: true, items: [{ id: "promo_a", sentence: "10% na wszystko" }], errors: [] })
  /* The coupon of the address alone in the list is still one coupon. */
  assert.deepEqual(cleanSendCoupons("promo_a", [{ id: "promo_a", sentence: "inne" }], "10%").items, [{ id: "promo_a", sentence: "10%" }])
})

test("several coupons: the one of the address first, once each, every sentence checked", () => {
  const r = cleanSendCoupons("promo_a", [{ id: "promo_b", sentence: " 20% na kremy " }, { id: "promo_a", sentence: "10% na wszystko" }, { id: "promo_b", sentence: "dubel" }, { id: "bad id!", sentence: "x" }, "junk"], "Wspólna instrukcja")
  assert.equal(r.ok, true)
  assert.deepEqual(r.items, [
    { id: "promo_a", sentence: "10% na wszystko" },
    { id: "promo_b", sentence: "dubel" },
  ])
  assert.deepEqual(cleanSendCoupons("promo_a", [{ id: "promo_b", sentence: "" }], "x").errors, ["sentence"])
  assert.deepEqual(cleanSendCoupons("promo_a", [{ id: "promo_b", sentence: "x".repeat(1001) }, { id: "promo_a", sentence: "ok" }], "x").errors, ["sentence_long"])
  const many = Array.from({ length: COUPONS_PER_SEND_MAX }, (_v, i) => ({ id: `promo_${i}`, sentence: "s" }))
  assert.deepEqual(cleanSendCoupons("promo_main", many, "x").errors, ["too_many_coupons"])
  assert.equal(cleanSendCoupons("promo_main", [{ id: "promo_main", sentence: "s" }, ...many.slice(1)], "x").ok, true)
  /* Several codes: the main one needs its own sentence too. */
  assert.deepEqual(cleanSendCoupons("promo_main", many.slice(1), "x").errors, ["sentence"])
})

test("per person only the codes she did not get, and whoever has all of them is skipped", () => {
  const plan = planMultiSend({
    requested: ["cus_1", "cus_2", "cus_3", "cus_nobody"],
    coupons: [
      { id: "promo_a", sent: [sent("cus_1"), sent("cus_3")], ruleIds: ["cus_1", "cus_3"] },
      { id: "promo_b", sent: [sent("cus_3")], ruleIds: [] },
    ],
    nobody: "cus_nobody",
  })
  assert.deepEqual(plan.toSend, ["cus_1", "cus_2"])
  assert.deepEqual(plan.skipped, ["cus_3"])
  assert.deepEqual(plan.codesOf, { cus_1: ["promo_b"], cus_2: ["promo_a", "promo_b"] })
  /* A coupon for chosen people gets the new ones on its list; one for everyone never narrows. */
  assert.deepEqual(plan.perCoupon.promo_a.addToRule, ["cus_2"])
  assert.deepEqual(plan.perCoupon.promo_a.ruleAfter, ["cus_1", "cus_3", "cus_2"])
  assert.deepEqual(plan.perCoupon.promo_b.addToRule, [])
  assert.equal(plan.perCoupon.promo_b.ruleAfter, null)
})

test("one coupon plans exactly as the single send", () => {
  const input = { requested: ["cus_1", "cus_2"], sent: [sent("cus_1")], ruleIds: ["cus_9"], nobody: null }
  const multi = planMultiSend({ requested: input.requested, coupons: [{ id: "promo_a", sent: input.sent, ruleIds: input.ruleIds }], nobody: null })
  const single = planSend(input)
  assert.deepEqual(multi.toSend, single.toSend)
  assert.deepEqual(multi.skipped, single.skipped)
  assert.deepEqual(multi.perCoupon.promo_a, single)
})

test("the rows: one code as before, several with the campaign and the codes of her e-mail", () => {
  const coupons = [
    { id: "promo_a", code: "AKADEMIA19" },
    { id: "promo_b", code: "AKADEMIA20" },
  ]
  assert.deepEqual(sentEntry({ customerId: "cus_1", email: "a@example.com" }, [coupons[0]], { at: AT, by: "biuro", campaign: null }), { customer_id: "cus_1", email: "a@example.com", at: AT, by: "biuro" })
  const campaign = campaignIdOf(new Date(AT), "1234-abcd-ef")
  assert.match(campaign, /^cm_[a-z0-9]+$/)
  const both = sentEntry({ customerId: "cus_2", email: "b@example.com", promotionIds: ["promo_a", "promo_b"] }, coupons, { at: AT, by: "biuro", campaign })
  assert.deepEqual(both, { customer_id: "cus_2", email: "b@example.com", at: AT, by: "biuro", campaign, codes: ["AKADEMIA19", "AKADEMIA20"] })
  const onlyB = sentEntry({ customerId: "cus_1", email: "a@example.com", promotionIds: ["promo_b"] }, coupons, { at: AT, by: "biuro", campaign })
  assert.deepEqual(onlyB, { customer_id: "cus_1", email: "a@example.com", at: AT, by: "biuro", campaign })
  /* Kept in the metadata and read back. */
  const meta = withSent({ other: 1 }, [both])
  assert.equal((meta as { other: number }).other, 1)
  assert.deepEqual(codeSentOf(meta), [both])
})

test("the results name the other codes of the same e-mail", () => {
  const campaign = "cm_x1"
  const { campaigns } = codeMailCampaigns({
    sent: [sent("cus_1", { campaign, codes: ["AKADEMIA19", "AKADEMIA20"] }), sent("cus_2", { campaign })],
    orders: [],
    delivery: null,
    ownCode: "AKADEMIA19",
  })
  assert.equal(campaigns.length, 1)
  assert.equal(campaigns[0].recipients, 2)
  assert.deepEqual(campaigns[0].withCodes, ["AKADEMIA20"])
  const single = codeMailCampaigns({ sent: [sent("cus_1")], orders: [], delivery: null, ownCode: "AKADEMIA19" })
  assert.equal("withCodes" in single.campaigns[0], false)
})
