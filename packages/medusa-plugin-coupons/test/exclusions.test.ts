/**
 * Single products left out of a discount on the store's pools: the creator
 * writes one more target rule (items.variant_id "ne" the left-out variants),
 * the reads give it back as excludedVariantIds, the edit form changes only
 * that rule, the sentence names what is left out. And Medusa's own engine
 * (its line item computation) gives the left-out variant no discount.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { checkWizard, cleanVariantIds, exclusionTargetRules, MAX_EXCLUDED_VARIANTS, promotionInput } from "../src/modules/coupons/lib/wizard.ts"
import { checkPatch, exclusionsEditable, targetChanges } from "../src/modules/coupons/lib/edit.ts"
import { shapeOf, toCouponDto, type PromotionLike } from "../src/modules/coupons/lib/describe.ts"
import { copyInput } from "../src/workflows/coupons/duplicate.ts"
import { poolRowsOf, productFilterOf } from "../src/workflows/coupons/terms.ts"
import { variantLabel } from "../src/workflows/coupons/reads.ts"
import { couponSentence, wizardCoupon } from "../src/admin/lib/coupons-sentence.ts"
import en from "../src/admin/i18n/en.ts"
import pl from "../src/admin/i18n/pl.ts"
import type { StoreFeature, WizardInput } from "../src/modules/coupons/lib/contract.ts"

const require = createRequire(import.meta.url)
const ALL: StoreFeature[] = ["note", "pools", "minQuantity", "priceLists", "buyGet", "combines", "perCustomerOrders", "threshold"]
const POOLS = [
  { id: "corneo", name: "Corneo", target: { attribute: "items.product.tags.id", values: ["ptag_corneo"] } },
  { id: "serums", name: "Serums", target: { attribute: "items.product.tags.id", values: ["ptag_serums"] } },
]
const now = new Date("2026-10-22T10:00:00.000Z")
const ctx = { now, currencyCode: "pln", memberGroupIds: [], features: ALL }

const base = (over: Partial<WizardInput> = {}): WizardInput => ({
  kind: "percent_pools",
  value: 15,
  poolIds: ["corneo"],
  audience: "everyone",
  mode: "code",
  code: "CORNEO15",
  validity: "none",
  terms: { minQuantity: 6 },
  ...over,
})

test("nothing left out: no extra rule, the coupon as before", () => {
  const c = checkWizard(base(), ctx)
  assert.equal(c.ok, true, c.errors.join(","))
  assert.deepEqual(c.value!.excludedVariantIds, [])
  const { promotion } = promotionInput(c.value!, { buyGetMarker: null, pools: POOLS })
  assert.deepEqual((promotion.application_method as any).target_rules, [{ attribute: "items.product.tags.id", operator: "in", values: ["ptag_corneo"] }])
})

test("products left out: one 'ne' rule on the variant next to the pool's rule", () => {
  const c = checkWizard(base({ excludedVariantIds: ["variant_200", "variant_200", "bad id!"] }), ctx)
  assert.deepEqual(c.value!.excludedVariantIds, ["variant_200"])
  const { promotion } = promotionInput(c.value!, { buyGetMarker: null, pools: POOLS })
  assert.deepEqual((promotion.application_method as any).target_rules, [
    { attribute: "items.product.tags.id", operator: "in", values: ["ptag_corneo"] },
    { attribute: "items.variant_id", operator: "ne", values: ["variant_200"] },
  ])
  /* Only a discount on pools leaves products out; other kinds ignore the list. */
  assert.deepEqual(checkWizard(base({ kind: "percent_order", excludedVariantIds: ["variant_200"] }), ctx).value!.excludedVariantIds, [])
})

test("the list is capped and cleaned", () => {
  const many = Array.from({ length: MAX_EXCLUDED_VARIANTS + 20 }, (_, i) => `variant_${i}`)
  assert.equal(cleanVariantIds(many).length, MAX_EXCLUDED_VARIANTS)
  assert.deepEqual(cleanVariantIds(null), [])
  assert.deepEqual(exclusionTargetRules([]), [])
})

/* Medusa's own engine, as the cart runs it: target rules joined with AND, "ne" on a list = none of them. */
test("Medusa gives the left-out variant no discount and keeps it on the rest of the pool", () => {
  const { getComputedActionsForItems } = require("@medusajs/promotion/dist/utils/compute-actions/line-items.js")
  const c = checkWizard(base({ excludedVariantIds: ["variant_200", "variant_x"] }), ctx)
  const { promotion } = promotionInput(c.value!, { buyGetMarker: null, pools: POOLS })
  const am = promotion.application_method as any
  const medusaPromotion = {
    code: promotion.code,
    is_tax_inclusive: false,
    application_method: { ...am, target_rules: am.target_rules.map((r: any) => ({ ...r, values: r.values.map((value: string) => ({ value })) })) },
  }
  const line = (id: string, variant: string, tag: string) => ({ id, quantity: 2, subtotal: 200, original_total: 200, variant_id: variant, product: { id: `prod_${id}`, tags: [{ id: tag }] } })
  const items = [line("ampoule", "variant_amp", "ptag_corneo"), line("cream200", "variant_200", "ptag_corneo"), line("serum", "variant_serum", "ptag_serums")]
  const actions = getComputedActionsForItems(medusaPromotion, items, new Map()) as Array<{ item_id: string; amount: unknown }>
  assert.deepEqual(actions.map((a) => a.item_id), ["ampoule"])
  assert.equal(Number(actions[0].amount), 30)
})

test("read back: the 'ne' variant rule is the list left out, not an unknown rule", () => {
  const p: PromotionLike = {
    id: "promo_1",
    code: "CORNEO15",
    application_method: {
      type: "percentage",
      target_type: "items",
      value: 15,
      target_rules: [
        { attribute: "items.product.tags.id", operator: "in", values: [{ value: "ptag_corneo" }] },
        { attribute: "items.variant_id", operator: "ne", values: [{ value: "variant_200" }] },
      ],
    },
  }
  const s = shapeOf(p)
  assert.deepEqual(s.excludedVariantIds, ["variant_200"])
  assert.deepEqual(s.tagIds, ["ptag_corneo"])
  assert.equal(s.rules.length, 0)
  /* A copy keeps the rule as it is. */
  assert.deepEqual((copyInput(p, "CORNEO16").application_method as any).target_rules[1], { attribute: "items.variant_id", operator: "ne", values: ["variant_200"] })
})

test("edit: only the exclusion rule changes; the same list writes nothing", () => {
  const current = { ...toCouponDto({ id: "promo_1", code: "CORNEO15", application_method: { type: "percentage", target_type: "items", value: 15, target_rules: [{ attribute: "items.variant_id", operator: "ne", values: [{ value: "variant_200" }] }] } }, undefined, now), terms: { pools: ["corneo"] } }
  assert.equal(exclusionsEditable(current), true)
  assert.equal(checkPatch({ excludedVariantIds: ["variant_200"] }, current, { features: ALL }).value!.excludedVariantIds, undefined)
  const add = checkPatch({ excludedVariantIds: ["variant_200", "variant_50"] }, current, { features: ALL })
  assert.deepEqual(add.value, { excludedVariantIds: ["variant_200", "variant_50"] })
  const targets = [
    { id: "r_tag", attribute: "items.product.tags.id", operator: "in" },
    { id: "r_ex", attribute: "items.variant_id", operator: "ne" },
  ]
  assert.deepEqual(targetChanges(add.value!, targets, { attrs: ["items.product.tags.id"], rules: [] }), {
    create: [{ attribute: "items.variant_id", operator: "ne", values: ["variant_200", "variant_50"] }],
    delete: ["r_ex"],
  })
  /* Everything back in: the rule goes, nothing new. */
  assert.deepEqual(targetChanges(checkPatch({ excludedVariantIds: [] }, current, { features: ALL }).value!, targets, { attrs: [], rules: [] }), { create: [], delete: ["r_ex"] })
  /* New pools keep the exclusion rule (it is "ne", the pools' rules are "in"). */
  assert.deepEqual(targetChanges({ poolIds: ["serums"] }, targets, { attrs: ["items.product.tags.id"], rules: [{ attribute: "items.product.tags.id", operator: "in", values: ["ptag_serums"] }] }).delete, ["r_tag"])
  /* Buy X get Y and order coupons leave no products out. */
  const order = toCouponDto({ id: "promo_2", code: "ALL10", application_method: { type: "percentage", target_type: "order", value: 10 } }, undefined, now)
  assert.deepEqual(checkPatch({ excludedVariantIds: ["variant_200"] }, order, { features: ALL }).errors, ["targets_fixed"])
})

function translator(dict: Record<string, unknown>) {
  return (key: string, o: Record<string, unknown> = {}) => {
    const v = key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), dict)
    return String(v ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(o[k] ?? ""))
  }
}
const fmt = { money: (n: number, c: string) => `${n} ${c.toUpperCase()}`, date: (iso: string) => iso.slice(0, 10) }
const NAMES = { groups: {}, categories: {}, products: {}, customers: {}, pools: { corneo: "CORNEObiotics" }, variants: { variant_200: "Krem Corneo 200 ml" } }

test("the sentence names what is left out, in English and in Polish", () => {
  const draft = wizardCoupon(base({ excludedVariantIds: ["variant_200"] }), { startsAt: null, endsAt: null })
  assert.equal(couponSentence(draft, NAMES, translator(en), fmt, "pln"), "15% off CORNEObiotics, without Krem Corneo 200 ml, from 6 pieces together, for everyone, with the code CORNEO15, with no end date, no limit of uses.")
  const plText = couponSentence(draft, NAMES, translator(pl as unknown as Record<string, unknown>), fmt, "pln").replace(/ /g, " ")
  assert.equal(plText, "15% rabatu na CORNEObiotics, bez: Krem Corneo 200 ml, od 6 szt. łącznie, dla wszystkich, z kodem CORNEO15, bez daty końca, bez limitu użyć.")
  const many = wizardCoupon(base({ excludedVariantIds: ["a_1", "a_2", "a_3", "a_4"] }), { startsAt: null, endsAt: null })
  assert.ok(couponSentence(many, NAMES, translator(en), fmt, "pln").includes(", without 4 chosen products,"))
  /* Nothing left out: the sentence as before. */
  assert.ok(!couponSentence(wizardCoupon(base(), { startsAt: null, endsAt: null }), NAMES, translator(en), fmt, "pln").includes("without"))
})

test("pool products: the target as a product filter, one row per variant, names of variants", () => {
  assert.deepEqual(productFilterOf({ attribute: "items.product.tags.id", values: ["ptag_corneo"] }), { tags: { id: ["ptag_corneo"] } })
  assert.deepEqual(productFilterOf({ attribute: "items.product.categories.id", values: ["pcat_1"] }), { categories: { id: ["pcat_1"] } })
  assert.equal(productFilterOf({ attribute: "customer.id", values: ["x"] }), null)
  assert.equal(productFilterOf(null), null)
  const rows = poolRowsOf([
    { id: "prod_b", title: "Krem Corneo", thumbnail: "https://cdn.example/b.png", variants: [{ id: "variant_200", title: "200 ml", sku: "K-200" }, { id: "variant_50", title: "50 ml", sku: "K-50" }] },
    { id: "prod_a", title: "Ampułki Corneo", thumbnail: null, variants: [{ id: "variant_amp", title: "Default variant", sku: null }] },
  ])
  assert.deepEqual(rows.map((r) => [r.variantId, r.title, r.variantTitle]), [
    ["variant_amp", "Ampułki Corneo", null],
    ["variant_200", "Krem Corneo", "200 ml"],
    ["variant_50", "Krem Corneo", "50 ml"],
  ])
  assert.equal(variantLabel({ title: "200 ml", product: { title: "Krem Corneo" } }), "Krem Corneo 200 ml")
  assert.equal(variantLabel({ title: "Krem Corneo 200 ml", product: { title: "Krem Corneo" } }), "Krem Corneo 200 ml")
  assert.equal(variantLabel({ title: "Default variant", product: { title: "Ampułki" } }), "Ampułki")
})
