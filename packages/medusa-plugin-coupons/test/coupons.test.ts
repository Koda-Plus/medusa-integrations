/**
 * Coupons: a promotion read back into the creator's terms, its status today,
 * the creator's checks, the promotion it builds, the warnings, and the plain
 * sentence in both languages.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isForCustomer, reachesProduct, shapeOf, statusOf, toCouponDto, usageOf, type PromotionLike } from "../src/modules/coupons/lib/describe.ts"
import { checkWizard, cleanCode, endOfMonth, promotionInput, suggestCode, wizardWarnings } from "../src/modules/coupons/lib/wizard.ts"
import { resolveOptions } from "../src/modules/coupons/lib/options.ts"
import { couponSentence, wizardCoupon } from "../src/admin/lib/coupons-sentence.ts"
import en from "../src/admin/i18n/en.ts"
import pl from "../src/admin/i18n/pl.ts"
import type { WizardInput } from "../src/modules/coupons/lib/contract.ts"

const NOW = new Date("2026-10-14T12:00:00Z")

const percentForGroups: PromotionLike = {
  id: "promo_1",
  code: "JESIEN15",
  status: "active",
  is_automatic: false,
  limit: 100,
  used: 37,
  campaign: { id: "camp_1", name: "JESIEN15", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-31T23:59:59Z" },
  application_method: { type: "percentage", target_type: "order", allocation: "across", value: 15 },
  rules: [
    { attribute: "customer.groups.id", operator: "in", values: [{ value: "cusgroup_b2b" }] },
    { attribute: "item_total", operator: "gte", values: [{ value: "300" }] },
    { attribute: "region.id", operator: "in", values: [{ value: "reg_1" }] },
  ],
}

test("a percent promotion for a group with a minimum reads back as such, other rules counted", () => {
  const s = shapeOf(percentForGroups)
  assert.equal(s.kind, "percent_order")
  assert.equal(s.value, 15)
  assert.deepEqual(s.groupIds, ["cusgroup_b2b"])
  assert.equal(s.minimum, 300)
  assert.equal(s.otherRules, 1)
})

test("free delivery, an amount with its currency rule, and a category target", () => {
  assert.equal(shapeOf({ id: "p", application_method: { type: "percentage", target_type: "shipping_methods", value: 100 } }).kind, "free_shipping")
  const fixed = shapeOf({ id: "p", application_method: { type: "fixed", target_type: "order", value: 50, currency_code: "PLN" }, rules: [{ attribute: "currency_code", operator: "eq", values: ["pln"] }] })
  assert.equal(fixed.kind, "fixed_order")
  assert.equal(fixed.currency, "pln")
  assert.equal(fixed.otherRules, 0)
  const cat = shapeOf({ id: "p", application_method: { type: "percentage", target_type: "items", value: 10, target_rules: [{ attribute: "items.product.categories.id", operator: "in", values: ["pcat_1", "pcat_2"] }] } })
  assert.equal(cat.kind, "percent_items")
  assert.deepEqual(cat.categoryIds, ["pcat_1", "pcat_2"])
})

test("the status today: paused, scheduled, expired, used up, active", () => {
  assert.equal(statusOf({ ...percentForGroups, status: "inactive" }, NOW), "paused")
  assert.equal(statusOf({ ...percentForGroups, campaign: { starts_at: "2026-11-01T00:00:00Z" } }, NOW), "scheduled")
  assert.equal(statusOf({ ...percentForGroups, campaign: { ends_at: "2026-10-01T00:00:00Z" } }, NOW), "expired")
  assert.equal(statusOf({ ...percentForGroups, limit: 37 }, NOW), "used_up")
  assert.equal(statusOf(percentForGroups, NOW), "active")
  assert.deepEqual(usageOf({ id: "p", campaign: { budget: { type: "usage", limit: 50, used: 9 } } }), { limit: 50, used: 9 })
})

test("who a coupon is for, and which products it reaches", () => {
  const s = shapeOf(percentForGroups)
  assert.equal(isForCustomer(s, "cus_1", ["cusgroup_b2b"]), true)
  assert.equal(isForCustomer(s, "cus_1", ["cusgroup_retail"]), false)
  assert.equal(reachesProduct(s, "prod_1", []), true)
  const cat = shapeOf({ id: "p", application_method: { type: "percentage", target_type: "items", value: 10, target_rules: [{ attribute: "items.product.categories.id", operator: "in", values: ["pcat_creams"] }] } })
  assert.equal(reachesProduct(cat, "prod_1", ["pcat_creams"]), true)
  assert.equal(reachesProduct(cat, "prod_2", ["pcat_toners"]), false)
})

const BASE: WizardInput = { kind: "percent_order", value: 15, audience: "everyone", mode: "code", code: "jesien 15", validity: "30d", limit: 100 }

test("the creator: a clean code, every missing answer named, dates from the validity", () => {
  assert.equal(cleanCode("  jesień 15!"), "JESIE-15")
  assert.equal(suggestCode({ kind: "free_shipping" }, "SHOP"), "SHOP-DOSTAWA0")
  const ok = checkWizard(BASE, { now: NOW, currencyCode: "pln" })
  assert.equal(ok.ok, true)
  assert.equal(ok.value?.code, "JESIEN-15")
  assert.equal(ok.value?.endsAt?.toISOString(), "2026-11-13T12:00:00.000Z")
  const bad = checkWizard({ ...BASE, value: 0, audience: "groups", groupIds: [], code: "x", validity: "custom", startsAt: "2026-11-02", endsAt: "2026-11-01" }, { now: NOW, currencyCode: "pln" })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.errors.sort(), ["code", "dates", "groups", "percent"])
  assert.equal(endOfMonth(NOW).toISOString(), "2026-10-31T23:59:59.999Z")
})

test("the creator builds an ordinary Medusa promotion and a campaign for its dates", () => {
  const w = checkWizard({ ...BASE, kind: "fixed_order", value: 50, minimum: 300, audience: "customer", customerId: "cus_1" }, { now: NOW, currencyCode: "pln" }).value!
  const { promotion, campaign } = promotionInput(w)
  assert.deepEqual(promotion.application_method, { type: "fixed", target_type: "order", allocation: "across", value: 50, currency_code: "pln" })
  assert.deepEqual(promotion.rules, [
    { attribute: "customer.id", operator: "eq", values: ["cus_1"] },
    { attribute: "item_total", operator: "gte", values: ["300"] },
    { attribute: "currency_code", operator: "eq", values: ["pln"] },
  ])
  assert.equal(promotion.limit, 100)
  assert.equal(promotion.is_automatic, false)
  assert.ok(campaign && campaign.ends_at && campaign.campaign_identifier.startsWith("koda-coupons-jesien-15-"))
  const ship = promotionInput(checkWizard({ ...BASE, kind: "free_shipping", validity: "none" }, { now: NOW, currencyCode: "pln" }).value!)
  assert.deepEqual(ship.promotion.application_method, { type: "percentage", target_type: "shipping_methods", allocation: "across", value: 100 })
  assert.equal(ship.campaign, null)
})

test("warnings: automatic for everyone, groups with own prices, stacking, half price, an amount without a minimum", () => {
  const active = [toCouponDto({ id: "p9", code: "AUTO10", status: "active", is_automatic: true, application_method: { type: "percentage", target_type: "order", value: 10 } }, undefined, NOW)]
  assert.deepEqual(wizardWarnings({ ...BASE, mode: "automatic" }, { active, memberGroupIds: [] }), ["automatic_everyone", "stacking"])
  assert.ok(wizardWarnings({ ...BASE, mode: "automatic", audience: "groups", groupIds: ["g_b2b"] }, { active: [], memberGroupIds: ["g_b2b"] }).includes("automatic_members"))
  assert.ok(wizardWarnings({ ...BASE, value: 60 }, { active: [], memberGroupIds: [] }).includes("big_percent"))
  assert.ok(wizardWarnings({ ...BASE, kind: "fixed_order", value: 50, minimum: null }, { active: [], memberGroupIds: [] }).includes("fixed_without_minimum"))
  assert.ok(wizardWarnings({ ...BASE, code: "auto10" }, { active, memberGroupIds: [] }).includes("code_taken"))
})

function translator(dict: Record<string, unknown>) {
  return (key: string, o: Record<string, unknown> = {}) => {
    const v = key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), dict)
    return String(v ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(o[k] ?? ""))
  }
}
const fmt = { money: (n: number, c: string) => `${n} ${c.toUpperCase()}`, date: (iso: string) => iso.slice(0, 10) }
const NAMES = { groups: { cusgroup_b2b: "B2B" }, categories: { pcat_1: "Kremy" }, products: {}, customers: {} }

test("every coupon in one sentence, in English and in Polish", () => {
  const c = toCouponDto(percentForGroups, undefined, NOW)
  assert.equal(
    couponSentence(c, NAMES, translator(en), fmt, "pln"),
    "15% off the whole order, for B2B, with the code JESIEN15, from 300 PLN, from 2026-10-01 until 2026-10-31, up to 100 uses, rule region.id is one of: reg_1.",
  )
  /* Polish copy is typeset: short words keep a no-break space to the next one. */
  const plText = couponSentence(c, NAMES, translator(pl as unknown as Record<string, unknown>), fmt, "pln").replace(/ /g, " ")
  assert.ok(plText.startsWith("15% rabatu na całe zamówienie, dla grup: B2B, z kodem JESIEN15"))
  const live = couponSentence(wizardCoupon({ ...BASE, kind: "percent_category", categoryIds: ["pcat_1"], mode: "automatic", limit: 1 }, { startsAt: null, endsAt: null }), NAMES, translator(en), fmt, "pln")
  assert.equal(live, "15% off Kremy, for everyone, applied by itself, no code, with no end date, single use.")
})

test("the rules of real promotions read by name: a collection, delivery types, a sales channel, an amount off delivery", () => {
  const names = { ...NAMES, collections: { pcol_1: "Detal" }, shippingTypes: { sotype_k: "Kurier", sotype_p: "Paczkomat" }, salesChannels: { sc_1: "Sklep" } }
  const detal = toCouponDto({ id: "p1", code: "DETAL12", application_method: { type: "percentage", target_type: "items", allocation: "each", value: 12, target_rules: [{ attribute: "items.product.collection_id", operator: "in", values: ["pcol_1"] }] } }, undefined, NOW)
  assert.equal(detal.shape.otherRules, 0)
  assert.equal(couponSentence(detal, names, translator(en), fmt, "pln"), "12% off products of the Detal collection, for everyone, with the code DETAL12, with no end date, no limit of uses.")
  assert.equal(reachesProduct(detal.shape, "prod_x", [], "pcol_1"), true)
  assert.equal(reachesProduct(detal.shape, "prod_x", [], "pcol_2"), false)
  const cod = toCouponDto({ id: "p2", code: "COD", is_automatic: true, application_method: { type: "fixed", target_type: "shipping_methods", value: 12.59, target_rules: [{ attribute: "shipping_methods.shipping_option.shipping_option_type_id", operator: "in", values: ["sotype_k", "sotype_p"] }] }, rules: [{ attribute: "sales_channel_id", operator: "in", values: ["sc_1"] }] }, undefined, NOW)
  assert.equal(cod.shape.kind, "fixed_shipping")
  assert.equal(couponSentence(cod, names, translator(en), fmt, "pln"), "12.59 PLN off delivery: Kurier and Paczkomat, in the Sklep sales channel, for everyone, applied by itself, no code, with no end date, no limit of uses.")
})

test("options: defaults, and bad values fall back with a problem named", () => {
  assert.deepEqual(resolveOptions(undefined), { currencyCode: "pln", memberGroupIds: [], codePrefix: null, problems: [] })
  const o = resolveOptions({ currencyCode: "euro", codePrefix: "to long prefix!", memberGroupIds: ["ok_1", 5 as unknown as string] })
  assert.equal(o.currencyCode, "pln")
  assert.equal(o.codePrefix, null)
  assert.deepEqual(o.memberGroupIds, ["ok_1"])
  assert.equal(o.problems.length, 3)
})
