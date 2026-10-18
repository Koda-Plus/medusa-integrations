/**
 * Editing a coupon: the form checked against the coupon as it is, only real
 * changes kept, the rules to delete and create, where the limit lives, and
 * the warnings before saving.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { checkPatch, editWarnings, limitLivesIn, patchIsEmpty, ruleChanges } from "../src/modules/coupons/lib/edit.ts"
import type { CouponDto } from "../src/modules/coupons/lib/contract.ts"

const coupon = (over: Partial<CouponDto> = {}, shape: Partial<CouponDto["shape"]> = {}): CouponDto => ({
  id: "promo_1",
  code: "JESIEN15",
  automatic: false,
  status: "active",
  medusaStatus: "active",
  shape: {
    kind: "percent_order",
    value: 15,
    currency: null,
    categoryIds: [],
    productIds: [],
    collectionIds: [],
    shippingTypeIds: [],
    shippingOptionIds: [],
    salesChannelIds: [],
    regionIds: [],
    groupIds: ["cusgroup_b2b"],
    customerIds: [],
    minimum: null,
    rules: [],
    otherRules: 0,
    ...shape,
  },
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-31T23:59:59.000Z",
  limit: 100,
  used: 12,
  campaign: { id: "camp_1", name: "JESIEN15" },
  stats: { orders: 12, discount: 300, revenue: 4000, newCustomers: 2, lastUsedAt: null },
  createdAt: null,
  ...over,
})

test("an unchanged form writes nothing", () => {
  const c = coupon()
  const r = checkPatch({ code: "jesien15", mode: "code", value: 15, limit: 100, minimum: null, groupIds: ["cusgroup_b2b"], customerIds: [] }, c)
  assert.equal(r.ok, true)
  assert.equal(patchIsEmpty(r.value!), true)
})

test("only what differs is kept, the code cleaned", () => {
  const r = checkPatch({ code: " zima 20 ", value: 20, limit: 150 }, coupon())
  assert.deepEqual(r.value, { code: "ZIMA-20", value: 20, limit: 150 })
})

test("a limit below the uses so far is refused", () => {
  assert.deepEqual(checkPatch({ limit: 5 }, coupon()).errors, ["limit_below_used"])
  assert.equal(checkPatch({ limit: null }, coupon()).value?.limit, null)
})

test("percent from 1 to 100, an amount above zero", () => {
  assert.deepEqual(checkPatch({ value: 120 }, coupon()).errors, ["percent"])
  const fixed = coupon({}, { kind: "fixed_order", value: 50, currency: "pln" })
  assert.deepEqual(checkPatch({ value: 0 }, fixed).errors, ["amount"])
  assert.equal(checkPatch({ value: 70 }, fixed).value?.value, 70)
})

test("the value of buy X get Y is not edited here", () => {
  const bxgy = coupon({}, { kind: "buy_get", value: 100 })
  assert.deepEqual(checkPatch({ value: 50 }, bxgy).errors, ["value_fixed"])
  assert.equal(checkPatch({ customerIds: ["cus_martyna"] }, bxgy).ok, true)
})

test("dates: end after start; the untouched side kept", () => {
  assert.deepEqual(checkPatch({ endsAt: "2026-09-01T00:00:00" }, coupon()).errors, ["dates"])
  const r = checkPatch({ endsAt: null }, coupon())
  assert.equal(r.value?.dates?.endsAt, null)
  assert.equal(r.value?.dates?.startsAt?.toISOString(), "2026-10-01T00:00:00.000Z")
})

test("audience: a customer added, groups emptied", () => {
  const r = checkPatch({ groupIds: [], customerIds: ["cus_martyna", "cus_martyna", "bad id!"] }, coupon())
  assert.deepEqual(r.value, { groupIds: [], customerIds: ["cus_martyna"] })
})

test("rules: only the changed attributes, an exclusion kept", () => {
  const rules = [
    { id: "r_g", attribute: "customer.groups.id", operator: "in" },
    { id: "r_x", attribute: "customer.groups.id", operator: "ne" },
    { id: "r_c", attribute: "customer_id", operator: "eq" },
    { id: "r_m", attribute: "item_total", operator: "gte" },
    { id: "r_cur", attribute: "currency_code", operator: "eq" },
  ]
  const out = ruleChanges({ customerIds: ["cus_a", "cus_b"], minimum: 300 }, rules)
  assert.deepEqual(out.delete.sort(), ["r_c", "r_m"])
  assert.deepEqual(out.create, [
    { attribute: "item_total", operator: "gte", values: ["300"] },
    { attribute: "customer.id", operator: "in", values: ["cus_a", "cus_b"] },
  ])
  assert.deepEqual(ruleChanges({ groupIds: [] }, rules), { create: [], delete: ["r_g"] })
})

test("the limit lives on the promotion unless only a usage budget holds it", () => {
  assert.equal(limitLivesIn({ limit: 10 }), "promotion")
  assert.equal(limitLivesIn({ limit: null, campaign: { budget: { type: "usage" } } }), "campaign")
  assert.equal(limitLivesIn({ limit: null, campaign: { budget: { type: "spend" } } }), "promotion")
})

test("warnings: a used code renamed, the audience opened to everyone, shared campaign dates", () => {
  const c = coupon()
  assert.deepEqual(editWarnings(checkPatch({ code: "NOWY10" }, c).value!, c), ["code_changed"])
  assert.deepEqual(editWarnings(checkPatch({ groupIds: [] }, c).value!, c), ["audience_widened"])
  assert.deepEqual(editWarnings(checkPatch({ mode: "automatic", groupIds: [] }, c).value!, c), ["automatic_everyone", "audience_widened"])
  assert.deepEqual(editWarnings(checkPatch({ endsAt: "2026-11-30T23:59:59Z" }, c).value!, c), ["campaign_dates"])
})
