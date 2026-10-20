/**
 * The store's own terms (option storeTerms), the new kinds and audiences of
 * the creator, the edit form on targets and terms, and a copy's code.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { checkWizard, nextCode, poolTargetRules, promotionInput, savedKind, suggestCode, wizardWarnings } from "../src/modules/coupons/lib/wizard.ts"
import { checkPatch, editWarnings, ruleChanges, targetChanges } from "../src/modules/coupons/lib/edit.ts"
import { shapeOf, withTerms, toCouponDto, isForCustomer } from "../src/modules/coupons/lib/describe.ts"
import { copyInput } from "../src/workflows/coupons/duplicate.ts"
import { resolveOptions } from "../src/modules/coupons/lib/options.ts"
import type { CouponDto, StoreFeature, WizardInput } from "../src/modules/coupons/lib/contract.ts"

const ALL: StoreFeature[] = ["note", "pools", "minQuantity", "priceLists", "buyGet", "combines", "perCustomerOrders", "threshold"]
const MEMBERS = ["cusgroup_verified", "cusgroup_premium"]
const POOLS = [
  { id: "creams", name: "Creams", target: { attribute: "items.product.tags.id", values: ["ptag_creams"] } },
  { id: "serums", name: "Serums", target: { attribute: "items.product.tags.id", values: ["ptag_serums"] } },
]
const now = new Date("2026-10-20T10:00:00.000Z")

const base = (over: Partial<WizardInput> = {}): WizardInput => ({
  kind: "percent_pools",
  value: 15,
  poolIds: ["creams", "serums"],
  audience: "members",
  mode: "code",
  code: "GROUPS15",
  validity: "none",
  ...over,
})

test("percent off pools: the pools' tags merged into one target rule, the B2B groups as the audience", () => {
  const c = checkWizard(base({ terms: { minQuantity: 6, perPool: true, basePriceList: "plist_2" } }), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: ALL })
  assert.equal(c.ok, true, c.errors.join(","))
  const { promotion } = promotionInput(c.value!, { buyGetMarker: null, pools: POOLS })
  assert.deepEqual(promotion.rules, [{ attribute: "customer.groups.id", operator: "in", values: MEMBERS }])
  assert.equal((promotion.application_method as any).allocation, "each")
  assert.deepEqual((promotion.application_method as any).target_rules, [{ attribute: "items.product.tags.id", operator: "in", values: ["ptag_creams", "ptag_serums"] }])
  assert.deepEqual(c.value!.terms, { minQuantity: 6, perPool: true, basePriceList: "plist_2", pools: ["creams", "serums"] })
  assert.equal(savedKind(c.value!, true), "percent_items")
})

test("percent off pools needs the store's pools and at least one", () => {
  assert.ok(checkWizard(base(), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: [] }).errors.includes("kind"))
  assert.ok(checkWizard(base({ poolIds: [] }), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: ALL }).errors.includes("pools"))
})

test("retail: everyone outside the member groups, through an 'is not' rule", () => {
  const c = checkWizard(base({ kind: "percent_order", audience: "retail" }), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: ALL })
  const { promotion } = promotionInput(c.value!)
  assert.deepEqual(promotion.rules, [{ attribute: "customer.groups.id", operator: "ne", values: MEMBERS }])
  assert.ok(checkWizard(base({ kind: "percent_order", audience: "retail" }), { now, currencyCode: "pln", memberGroupIds: [], features: ALL }).errors.includes("members"))
})

test("buy X get Y counted by the store: a marker percent in Medusa, the numbers in the store's terms", () => {
  const c = checkWizard(base({ kind: "buy_get", value: null, buyGet: { buy: 7, free: 1, freePrice: 1 }, audience: "customer", customerIds: ["cus_a", "cus_b"], terms: { perCustomerOrders: 1 } }), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: ALL })
  assert.equal(c.ok, true, c.errors.join(","))
  const { promotion } = promotionInput(c.value!, { buyGetMarker: 0.001, pools: POOLS })
  assert.equal(promotion.type, "standard")
  assert.equal((promotion.application_method as any).value, 0.001)
  assert.deepEqual(promotion.rules, [{ attribute: "customer.id", operator: "in", values: ["cus_a", "cus_b"] }])
  assert.deepEqual(c.value!.terms, { perCustomerOrders: 1, pools: ["creams", "serums"], buyGet: { buy: 7, free: 1, freePrice: 1 } })
  assert.equal(savedKind(c.value!, true), "store_buy_get")
})

test("buy X get Y without the store: Medusa's own buyget on categories", () => {
  const input = base({ kind: "buy_get", value: null, poolIds: [], categoryIds: ["pcat_krem"], buyGet: { buy: 6, free: 1 }, audience: "everyone" })
  assert.ok(checkWizard({ ...input, categoryIds: [] }, { now, currencyCode: "pln", features: [] }).errors.includes("category"))
  const c = checkWizard(input, { now, currencyCode: "pln", features: [] })
  const { promotion } = promotionInput(c.value!)
  assert.equal(promotion.type, "buyget")
  const am = promotion.application_method as any
  assert.equal(am.buy_rules_min_quantity, 6)
  assert.equal(am.apply_to_quantity, 1)
  assert.deepEqual(am.buy_rules, [{ attribute: "items.product.categories.id", operator: "in", values: ["pcat_krem"] }])
  assert.equal(c.value!.terms, null)
})

test("a limit per customer needs chosen customers", () => {
  const c = checkWizard(base({ kind: "percent_order", audience: "everyone", terms: { perCustomerOrders: 1 } }), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: ALL })
  assert.ok(c.errors.includes("per_customer_audience"))
})

test("terms of features the store does not keep are dropped", () => {
  const c = checkWizard(base({ kind: "percent_order", terms: { note: "Hej", combines: { with: ["VIP5"], never: [] } } }), { now, currencyCode: "pln", memberGroupIds: MEMBERS, features: ["note"] })
  assert.deepEqual(c.value!.terms, { note: "Hej" })
})

test("a coupon it adds up with is no stacking warning; an unknown code is", () => {
  const auto = { ...dto(), code: "VIP5", automatic: true, status: "active" as const, shape: { ...dto().shape, kind: "percent_items" as const } }
  const w = wizardWarnings(base({ kind: "percent_pools", terms: { combines: { with: ["VIP5"], never: ["NIEMA"] } } }), { active: [auto], memberGroupIds: MEMBERS })
  assert.ok(!w.includes("stacking"))
  assert.ok(w.includes("combines_unknown"))
})

test("a copy's code: the first number goes up, a code without one gets -2", () => {
  assert.equal(nextCode("7GRATIS1"), "8GRATIS1")
  assert.equal(nextCode("7GRATIS1", ["8GRATIS1"]), "9GRATIS1")
  assert.equal(nextCode("JESIEN"), "JESIEN-2")
  assert.equal(suggestCode({ kind: "buy_get", buyGet: { buy: 7, free: 1 } }, "CB"), "CB-7PLUS1")
})

function dto(over: Partial<CouponDto> = {}): CouponDto {
  return {
    id: "promo_1",
    code: "7GRATIS1",
    automatic: false,
    status: "active",
    medusaStatus: "active",
    shape: { kind: "percent_items", value: 15, currency: null, categoryIds: [], productIds: [], collectionIds: [], shippingTypeIds: [], shippingOptionIds: [], salesChannelIds: [], regionIds: [], groupIds: [], customerIds: [], minimum: null, rules: [], otherRules: 0, tagIds: ["ptag_creams"], excludedGroupIds: [] },
    startsAt: null,
    endsAt: null,
    limit: null,
    used: 0,
    campaign: null,
    stats: { orders: 0, discount: 0, revenue: 0, newCustomers: 0, lastUsedAt: null },
    createdAt: null,
    terms: { pools: ["creams"], minQuantity: 6 },
    ...over,
  }
}

test("the store's buy X get Y reads as buy X get Y, not as its marker percent", () => {
  const c = withTerms(toCouponDto({ id: "p", code: "7GRATIS1", application_method: { type: "percentage", target_type: "items", value: 0.001 } }, undefined, now), { buyGet: { buy: 7, free: 1, freePrice: 1 } })
  assert.equal(c.shape.kind, "buy_get")
  assert.equal(c.shape.value, null)
  assert.deepEqual(c.shape.buyGet, { buy: 7, free: 1 })
})

test("shape: tags and 'is not' groups are read, retail customers reached", () => {
  const s = shapeOf({
    id: "p",
    rules: [{ attribute: "customer.groups.id", operator: "ne", values: [{ value: "cusgroup_b2b" }] }],
    application_method: { type: "percentage", target_type: "items", value: 10, target_rules: [{ attribute: "items.product.tags.id", operator: "in", values: [{ value: "ptag_1" }] }] },
  })
  assert.deepEqual(s.excludedGroupIds, ["cusgroup_b2b"])
  assert.deepEqual(s.tagIds, ["ptag_1"])
  assert.equal(s.rules.length, 0)
  assert.equal(isForCustomer(s, "cus_1", []), true)
  assert.equal(isForCustomer(s, "cus_1", ["cusgroup_b2b"]), false)
})

test("edit: new pools replace the pool targets, the store's terms merged with the form's keys", () => {
  const c = dto()
  const r = checkPatch({ poolIds: ["creams", "serums"], terms: { minQuantity: 12, note: "From 12 pieces" } }, c, { features: ALL })
  assert.equal(r.ok, true, r.errors.join(","))
  assert.deepEqual(r.value!.poolIds, ["creams", "serums"])
  assert.deepEqual(r.value!.terms, { pools: ["creams", "serums"], minQuantity: 12, note: "From 12 pieces" })
  const changes = targetChanges(r.value!, [{ id: "t1", attribute: "items.product.tags.id", operator: "in" }, { id: "t2", attribute: "items.product.collection_id", operator: "eq" }], { attrs: ["items.product.tags.id"], rules: poolTargetRules(["creams", "serums"], POOLS) as any })
  assert.deepEqual(changes.delete, ["t1"])
  assert.deepEqual(changes.create, [{ attribute: "items.product.tags.id", operator: "in", values: ["ptag_creams", "ptag_serums"] }])
})

test("edit: an unchanged form with terms writes nothing", () => {
  const c = dto()
  const r = checkPatch({ poolIds: ["creams"], terms: { minQuantity: 6, perPool: false, note: null, combines: null } }, c, { features: ALL })
  assert.deepEqual(r.value, {})
})

test("edit: retail as an 'is not' rule, the store's nobody marker gives way to a real customer", () => {
  const c = dto({ shape: { ...dto().shape, customerIds: ["nobody-left"] } })
  const r = checkPatch({ customerIds: ["nobody-left", "cus_new"] }, c, { features: ALL, nobody: "nobody-left" })
  assert.deepEqual(r.value!.customerIds, ["cus_new"])
  const rules = ruleChanges({ excludedGroupIds: MEMBERS }, [{ id: "r1", attribute: "customer.groups.id", operator: "ne" }, { id: "r2", attribute: "customer.groups.id", operator: "in" }])
  assert.deepEqual(rules.delete, ["r1"])
  assert.deepEqual(rules.create, [{ attribute: "customer.groups.id", operator: "ne", values: MEMBERS }])
})

test("edit: dropping every target warns that the discount reaches every product", () => {
  const c = dto()
  const r = checkPatch({ poolIds: [] }, c, { features: ALL })
  assert.ok(editWarnings(r.value!, c).includes("targets_widened"))
})

test("a copy keeps every rule, target and buy rule, under the new code, active", () => {
  const input = copyInput(
    {
      id: "p",
      code: "7GRATIS1",
      type: "standard",
      status: "inactive",
      is_automatic: false,
      limit: null,
      application_method: { type: "percentage", target_type: "items", allocation: "each", value: 0.001, max_quantity: 999, target_rules: [{ attribute: "items.product.collection_id", operator: "in", values: [{ value: "pcol_1" }] }] },
      rules: [{ attribute: "customer.groups.id", operator: "in", values: [{ value: "g1" }, { value: "g2" }] }],
    },
    "8GRATIS1",
  )
  assert.equal(input.code, "8GRATIS1")
  assert.equal(input.status, "active")
  assert.deepEqual((input.application_method as any).target_rules, [{ attribute: "items.product.collection_id", operator: "in", values: ["pcol_1"] }])
  assert.deepEqual(input.rules, [{ attribute: "customer.groups.id", operator: "in", values: ["g1", "g2"] }])
  assert.equal((input.application_method as any).max_quantity, 999)
})

test("options: a store adapter without read and write is a problem, features filtered", () => {
  assert.ok(resolveOptions({ storeTerms: {} as any }).problems.some((p) => p.startsWith("storeTerms")))
  const o = resolveOptions({ storeTerms: { features: ["pools", "nope" as any], lookups: async () => ({}), read: async () => ({}), write: async () => undefined } })
  assert.deepEqual(o.storeTerms!.features, ["pools"])
  assert.equal(o.storeTerms!.buyGetMarker, 0.001)
})
