/**
 * The short sentence of a coupon, on three real coupons of a store (codes
 * made up): the essentials first, delivery coupons as "free delivery", the
 * member groups by one name, a single day as "only", long code lists counted
 * or "other coupons", no "no end date" and no "no limit". The side panel's
 * fields keep everything in full.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { couponCodesOf, toCouponDto, withTerms, type PromotionLike } from "../src/modules/coupons/lib/describe.ts"
import { resolveOptions } from "../src/modules/coupons/lib/options.ts"
import { couponFacts, couponSentence } from "../src/admin/lib/coupons-sentence.ts"
import en from "../src/admin/i18n/en.ts"
import pl from "../src/admin/i18n/pl.ts"
import type { CouponDto, NameMaps, StoreTerms } from "../src/modules/coupons/lib/contract.ts"

const NOW = new Date("2026-09-01T12:00:00Z")

function translator(dict: Record<string, unknown>) {
  return (key: string, o: Record<string, unknown> = {}) => {
    const v = key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), dict)
    return String(v ?? o.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(o[k] ?? ""))
  }
}
const tPl = translator(pl as unknown as Record<string, unknown>)
const tEn = translator(en as unknown as Record<string, unknown>)
const fmtPl = {
  lang: "pl-PL",
  money: (n: number, c: string) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: c.toUpperCase(), maximumFractionDigits: 2 }).format(n),
  date: (iso: string) => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }).format(new Date(iso)),
}
const fmtEn = { ...fmtPl, lang: "en-GB", date: (iso: string) => iso.slice(0, 10) }
/** Polish copy is typeset (a no-break space after short words): compared as plain spaces. */
const plain = (s: string) => s.replace(/ /g, " ")

const MEMBERS = ["cusgroup_verified", "cusgroup_certified", "cusgroup_premium"]
const SHIPPING_CODES = ["SHIP_B2B", "SHIP_RETAIL", "SHIP_GUEST", "SHIP_B2B_COD_LOCKER", "SHIP_B2B_COD_COURIER", "SHIP_RETAIL_COD_LOCKER", "SHIP_RETAIL_COD_COURIER", "SHIP_GUEST_COD_LOCKER", "SHIP_GUEST_COD_COURIER"]
const FORTY = Array.from({ length: 40 }, (_v, i) => `PROMO${String(i + 1).padStart(2, "0")}`)

const coupon = (p: PromotionLike, terms: StoreTerms): CouponDto => withTerms(toCouponDto(p, undefined, NOW), terms)
const groupsRule = { attribute: "customer.groups.id", operator: "in", values: MEMBERS }
const ship = (code: string): PromotionLike => ({ id: `p_${code}`, code, status: "active", application_method: { type: "percentage", target_type: "shipping_methods", value: 100 } })
const discount = (code: string, ended = false): PromotionLike => ({
  id: `p_${code}`,
  code,
  status: "active",
  campaign: ended ? { ends_at: "2026-08-01T00:00:00Z" } : null,
  application_method: { type: "percentage", target_type: "order", value: 5 },
})

/* The store's coupons: delivery ones, the 40 promotions (5 already ended), and the three examples' neighbours. */
const STORE: PromotionLike[] = [...SHIPPING_CODES.map(ship), ...FORTY.map((c, i) => discount(c, i < 5)), discount("TIER3500"), discount("TIER4500"), discount("RETAIL6"), discount("RETAIL12")]

const NAMES: NameMaps = {
  groups: { cusgroup_verified: "Business Verified", cusgroup_certified: "Business Certified", cusgroup_premium: "Business Premium" },
  categories: {},
  products: {},
  customers: {},
  collections: { pcol_salon: "Salon care" },
  pools: { pool_salon: "Salon only", pool_mask: "Masks", pool_makeup: "Make-up removal", pool_eye: "Eye cream 15 ml", pool_map: "Skin map" },
  priceLists: { pl_b2b1: "Partner price | 1" },
  variants: { variant_wash: "Lipid wash 200 ml", variant_essence: "Reset essence 500 ml / no pump" },
  members: { ids: MEMBERS, label: { pl: "salonów B2B", en: "B2B salons" } },
}

/* 1. Automatic 2% for the member groups from 2,500 net, with free delivery, never with the two tier coupons. */
const tier = coupon(
  { id: "p_tier2500", code: "TIER2500", status: "active", is_automatic: true, application_method: { type: "percentage", target_type: "order", value: 2 }, rules: [groupsRule] },
  { threshold: { value: 2500, metric: "net" }, combines: { with: ["SHIP_B2B", "SHIP_RETAIL"], never: ["TIER3500", "TIER4500"] } },
)
/* 2. 5% on a pool and a collection from a partner price list, three days, 100 uses, with nine delivery coupons and two others. */
const salon = coupon(
  {
    id: "p_salon5",
    code: "SALON5",
    status: "active",
    limit: 100,
    campaign: { starts_at: "2026-09-23T22:00:00Z", ends_at: "2026-09-26T21:59:59Z" },
    application_method: { type: "percentage", target_type: "items", value: 5, target_rules: [{ attribute: "items.product.collection_id", operator: "in", values: ["pcol_salon"] }] },
    rules: [groupsRule],
  },
  { pools: ["pool_salon"], basePriceList: "pl_b2b1", combines: { with: [...SHIPPING_CODES, "RETAIL6", "RETAIL12"], never: [] } },
)
/* 3. 14% on five pools without two products, one day, never with 40 codes. */
const academy = coupon(
  {
    id: "p_academy14",
    code: "ACADEMY14",
    status: "scheduled",
    campaign: { starts_at: "2026-11-03T23:00:00Z", ends_at: "2026-11-04T22:59:59Z" },
    application_method: { type: "percentage", target_type: "items", value: 14, target_rules: [{ attribute: "items.variant_id", operator: "ne", values: ["variant_wash", "variant_essence"] }] },
    rules: [groupsRule],
  },
  { pools: ["pool_mask", "pool_makeup", "pool_eye", "pool_map", "pool_salon"], combines: { with: [], never: FORTY } },
)

const ALL = [...STORE.map((p) => toCouponDto(p, undefined, NOW)), tier, salon, academy]
const N: NameMaps = { ...NAMES, couponCodes: couponCodesOf(ALL) }

test("a store's automatic tier coupon: free delivery by name, the member groups by one name, no noise", () => {
  assert.equal(
    plain(couponSentence(tier, N, tPl, fmtPl, "pln")),
    "2% rabatu na całe zamówienie, naliczany sam, bez kodu, dla salonów B2B, koszyk od 2500,00 zł netto, łączy się z darmową dostawą.",
  )
  assert.equal(
    plain(couponSentence(tier, N, tEn, fmtEn, "pln")),
    "2% off the whole order, applied by itself, no code, for B2B salons, cart from 2500,00 zł net, adds up with free delivery.",
  )
})

test("a coupon on a pool and a collection: the targets read as a list, nine delivery codes become free delivery", () => {
  assert.equal(
    plain(couponSentence(salon, N, tPl, fmtPl, "pln")),
    "5% rabatu na: Salon only i kolekcja Salon care, z kodem SALON5, od 24 wrz 2026 do 26 wrz 2026, dla salonów B2B, od ceny „Partner price | 1”, do 100 użyć łącznie, łączy się z darmową dostawą, RETAIL6 i RETAIL12.",
  )
})

test("a one-day coupon that never goes with any other coupon: 'only' that day, 'other coupons', the 40 codes in the side panel", () => {
  /* The 40 codes are every other coupon that can still apply (the ended ones may be on the list too). */
  const complete = [...SHIPPING_CODES.map(ship), ...FORTY.map((c, i) => discount(c, i < 5))].map((p) => toCouponDto(p, undefined, NOW))
  const N: NameMaps = { ...NAMES, couponCodes: couponCodesOf([...complete, academy]) }
  const text = plain(couponSentence(academy, N, tPl, fmtPl, "pln"))
  assert.equal(
    text,
    "14% rabatu na: Masks, Make-up removal, Eye cream 15 ml, Skin map i Salon only, bez: Lipid wash 200 ml i Reset essence 500 ml / no pump, z kodem ACADEMY14, tylko 4 lis 2026, dla salonów B2B.",
  )
  /* A coupon the list does not name can still apply with it: the codes are counted, not said to be all. */
  const more: NameMaps = { ...N, couponCodes: couponCodesOf([...complete, academy, toCouponDto(discount("NEW10"), undefined, NOW)]) }
  assert.ok(plain(couponSentence(academy, more, tPl, fmtPl, "pln")).endsWith("dla salonów B2B."))
  /* Without the store's codes (a card that has no list): counted too. */
  assert.ok(!plain(couponSentence(academy, NAMES, tPl, fmtPl, "pln")).includes("nie łączy"))

  const facts = couponFacts(academy, N, tPl, fmtPl, "pln")
  const by = (k: string) => facts.find((f) => f.key === k)
  assert.equal(by("combinesNever")?.codes?.length, 40)
  assert.equal(plain(by("audience")?.value ?? ""), "Dla grup: Business Verified, Business Certified i Business Premium")
  assert.equal(plain(by("uses")?.value ?? ""), "Bez limitu użyć")
  assert.equal(by("combinesWith"), undefined)
})

test("the side panel keeps what the sentence leaves out", () => {
  const facts = couponFacts(tier, N, tPl, fmtPl, "pln")
  const by = (k: string) => plain(facts.find((f) => f.key === k)?.value ?? "")
  assert.equal(by("validity"), "Bez daty końca")
  assert.equal(by("conditions"), "Koszyk od 2500,00 zł netto, liczony przed rabatami")
  assert.equal(by("combinesWith"), "Darmową dostawą")
  assert.deepEqual(facts.find((f) => f.key === "combinesWith")?.codes, ["SHIP_B2B", "SHIP_RETAIL"])
})

test("member groups: the plugin's own words without the option, retail as everyone except them, a group less is listed", () => {
  const own: NameMaps = { ...N, members: { ids: MEMBERS, label: null } }
  assert.ok(plain(couponSentence(tier, own, tPl, fmtPl, "pln")).includes("dla klientów z cenami partnerskimi,"))
  const retail = coupon({ id: "p_r", code: "RETAIL6", application_method: { type: "percentage", target_type: "order", value: 6 }, rules: [{ attribute: "customer.groups.id", operator: "ne", values: MEMBERS }] }, {})
  assert.ok(plain(couponSentence(retail, N, tPl, fmtPl, "pln")).includes("dla wszystkich z wyjątkiem salonów B2B"))
  const two = coupon({ id: "p_2", code: "TWO", application_method: { type: "percentage", target_type: "order", value: 6 }, rules: [{ attribute: "customer.groups.id", operator: "in", values: MEMBERS.slice(0, 2) }] }, {})
  assert.ok(plain(couponSentence(two, N, tPl, fmtPl, "pln")).includes("dla grup: Business Verified i Business Certified"))
  assert.deepEqual(resolveOptions({ memberGroupsLabel: "B2B salons" }).memberGroupsLabel, { "*": "B2B salons" })
  assert.equal(resolveOptions({ memberGroupsLabel: 5 as never }).problems.length, 1)
})

test("delivery coupons on both sides are named, not 'free delivery' twice", () => {
  const both = coupon({ id: "p_b", code: "BOTH", application_method: { type: "percentage", target_type: "order", value: 3 } }, { combines: { with: ["SHIP_B2B"], never: ["SHIP_GUEST"] } })
  assert.ok(plain(couponSentence(both, N, tPl, fmtPl, "pln")).endsWith("łączy się z SHIP_B2B."))
})
