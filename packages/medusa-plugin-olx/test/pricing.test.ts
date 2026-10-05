import { test } from "node:test"
import assert from "node:assert/strict"
import { advertPrice, basePrice, buildPriceUpdateBody, planPrices, type PriceVariant } from "../src/modules/olx/lib/pricing.ts"

test("base price: the market currency, no price list, no rules, no quantity tier", () => {
  const prices = [
    { amount: 99, currency_code: "eur" },
    { amount: 349, currency_code: "pln" },
    { amount: 299, currency_code: "pln", price_list_id: "plist_sale" },
    { amount: 279, currency_code: "pln", rules_count: 1 },
    { amount: 250, currency_code: "pln", min_quantity: 10 },
    { amount: "0", currency_code: "pln" },
  ]
  assert.equal(basePrice(prices, "PLN"), 349)
  assert.equal(basePrice(prices, "uah"), null)
  assert.equal(basePrice([], "pln"), null)
  assert.equal(basePrice([{ amount: "149.90", currency_code: "PLN", min_quantity: 1 }], "pln"), 149.9)
})

const pv = (id: string, over: Partial<PriceVariant> = {}): PriceVariant => ({
  id,
  productId: `prod_${id}`,
  sku: id,
  productStatus: "published",
  stock: { kind: "tracked", available: 1 },
  price: 100,
  ...over,
})

test("price plan: live linked adverts whose OLX price differs, big changes held, nothing guessed", () => {
  const variants = new Map<string, PriceVariant>([
    ["same", pv("same", { price: 100 })],
    ["up", pv("up", { price: 110 })],
    ["double", pv("double", { price: 250 })],
    ["noprice", pv("noprice", { price: null })],
    ["sold", pv("sold", { stock: { kind: "tracked", available: 0 } })],
    ["draft", pv("draft", { productStatus: "draft" })],
  ])
  const adverts = [
    { olxId: "1", status: "active", variantId: "same", title: "a", price: { value: 100.001, currency: "PLN" } },
    { olxId: "2", status: "active", variantId: "up", title: "b", price: { value: 100, currency: "PLN" } },
    { olxId: "3", status: "active", variantId: "double", title: "c", price: { value: 100, currency: "PLN" } },
    { olxId: "4", status: "active", variantId: "noprice", title: "d", price: { value: 100, currency: "PLN" } },
    { olxId: "5", status: "active", variantId: "sold", title: "e", price: { value: 90, currency: "PLN" } },
    { olxId: "6", status: "active", variantId: "draft", title: "f", price: { value: 90, currency: "PLN" } },
    { olxId: "7", status: "limited", variantId: "up", title: "g", price: { value: 90, currency: "PLN" } },
    { olxId: "8", status: "active", variantId: "up", title: "h", price: { value: 90, currency: "EUR" } },
    { olxId: "9", status: "active", variantId: "up", title: "i", price: null },
  ]
  const plan = planPrices({ adverts, variants, currency: "pln", maxChangePercent: 50, readComplete: true, catalogComplete: true })
  assert.deepEqual(
    plan.actions.map((x) => [x.olxId, x.from.value, x.to.value, x.held]),
    [
      ["2", 100, 110, false],
      ["3", 100, 250, true],
    ],
  )
  assert.equal(plan.actions[0].changePercent, 10)
  assert.equal(plan.noPrice, 1)
  assert.equal(plan.otherCurrency, 2)
  assert.equal(planPrices({ adverts, variants, currency: "pln", maxChangePercent: 50, readComplete: false, catalogComplete: true }).skipped, "incomplete_read")
  assert.equal(planPrices({ adverts, variants, currency: "pln", maxChangePercent: 50, readComplete: true, catalogComplete: false }).actions.length, 0)
})

const fullAdvert = {
  data: {
    id: 1012345678,
    status: "active",
    url: "https://www.olx.pl/d/oferta/x.html",
    created_at: "2026-09-01 10:00:00",
    activated_at: "2026-09-01 10:00:00",
    valid_to: "2026-10-01 10:00:00",
    title: "Wiertarko-wkrętarka 18V z akumulatorami",
    description: "Opis ogłoszenia, wystarczająco długi.",
    category_id: 1559,
    advertiser_type: "business",
    external_id: "KS-ELN-18V",
    external_url: "",
    contact: { name: "Sklep", phone: "500600700" },
    location: { city_id: 5659, district_id: null, latitude: 54.36, longitude: 18.63 },
    images: [{ url: "https://ireland.apollo.olxcdn.com/v1/files/a/image" }, { url: "" }],
    price: { value: 349, currency: "PLN", negotiable: true, trade: false, budget: false },
    salary: null,
    attributes: [
      { code: "state", value: "new", values: null },
      { code: "year", value: 2015, values: null },
      { code: "colors", value: null, values: ["red", "blue"] },
      { code: "empty", value: null, values: null },
    ],
    courier: null,
    ad_delivery: { delivery_package_ids: [] },
    auto_extend_enabled: true,
    product_safety_regulation: { placed_before_2024: false },
  },
}

test("update body: every documented field copied, the price changed, extra and empty fields left out", () => {
  assert.deepEqual(advertPrice(fullAdvert), { value: 349, currency: "PLN" })
  const built = buildPriceUpdateBody(fullAdvert, 329.999)
  assert.equal(built.ok, true)
  if (!built.ok) return
  const b = built.body
  assert.deepEqual(Object.keys(b).sort(), [
    "advertiser_type",
    "attributes",
    "category_id",
    "contact",
    "description",
    "external_id",
    "images",
    "location",
    "price",
    "product_safety_regulation",
    "title",
  ])
  assert.deepEqual(b.price, { value: 330, currency: "PLN", negotiable: true, trade: false, budget: false })
  assert.deepEqual(b.contact, { name: "Sklep", phone: "500600700" })
  assert.deepEqual(b.location, { city_id: 5659, latitude: 54.36, longitude: 18.63 })
  assert.deepEqual(b.images, [{ url: "https://ireland.apollo.olxcdn.com/v1/files/a/image" }])
  assert.deepEqual(b.attributes, [
    { code: "state", value: "new" },
    { code: "year", value: "2015" },
    { code: "colors", values: ["red", "blue"] },
  ])
  assert.ok(!("auto_extend_enabled" in b), "omitted, so OLX keeps the setting")
  assert.ok(!("external_url" in b), "empty, and only some partners may send it")
})

test("update body: a missing required field is an error, never a partial advert", () => {
  const broken = { data: { ...fullAdvert.data, contact: { phone: "1" } } }
  const built = buildPriceUpdateBody(broken, 300)
  assert.equal(built.ok, false)
  if (built.ok) return
  assert.match(built.error, /contact\.name/)
  const nested = { data: { ...fullAdvert.data, location: undefined, contact: { name: "Sklep", location: { city_id: 1 } } } }
  const fromContact = buildPriceUpdateBody(nested, 300)
  assert.equal(fromContact.ok, true, "the location may come nested in contact, as in the documented example")
  assert.equal(buildPriceUpdateBody(null, 1).ok, false)
})
