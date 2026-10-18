/**
 * Delivery mapping and the basket the app shows: the mapped option wins,
 * demo falls back to the first option of the cart, sandbox and live refuse
 * an unmapped delivery; the locker travels as machine_id; the basket
 * amounts are { net, gross, vat } with two decimals.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeMapping, offeredDeliveries, pickShippingOption, safeLockerCode, shippingMethodData } from "../src/modules/inpostpay/lib/delivery.ts"
import { basketPayload, cartTotalMinor, currencySupported, lineItemFor, price, priceFromRate } from "../src/modules/inpostpay/lib/basket.ts"

const OPTIONS = [
  { id: "so_locker", name: "Paczkomat", provider_id: "inpost_inpost" },
  { id: "so_courier", name: "Kurier", provider_id: "manual_manual" },
]

test("mapping: only the three types and shipping option ids are kept", () => {
  assert.deepEqual(normalizeMapping({ APM: "so_locker", COURIER: " so_courier ", DIGITAL: "drop table", EXTRA: "so_x" }), { APM: "so_locker", COURIER: "so_courier", DIGITAL: null })
  assert.deepEqual(normalizeMapping(null), { APM: null, COURIER: null, DIGITAL: null })
  assert.deepEqual(normalizeMapping(["so_locker"]), { APM: null, COURIER: null, DIGITAL: null })
})

test("pick: the mapped option wins when the cart can use it", () => {
  const mapping = { APM: "so_locker", COURIER: "so_courier", DIGITAL: null }
  assert.deepEqual(pickShippingOption({ type: "COURIER", mapping, available: OPTIONS, demo: false }), { ok: true, id: "so_courier", fallback: false })
  assert.deepEqual(pickShippingOption({ type: "APM", mapping, available: OPTIONS, demo: true }), { ok: true, id: "so_locker", fallback: false })
})

test("pick: sandbox and live refuse what is not mapped or not available", () => {
  const none = { APM: null, COURIER: null, DIGITAL: null }
  const r1 = pickShippingOption({ type: "APM", mapping: none, available: OPTIONS, demo: false })
  assert.equal(r1.ok, false)
  assert.equal(r1.ok === false && r1.code, "DELIVERY_NOT_MAPPED")
  const r2 = pickShippingOption({ type: "APM", mapping: { ...none, APM: "so_gone" }, available: OPTIONS, demo: false })
  assert.equal(r2.ok === false && r2.code, "DELIVERY_NOT_AVAILABLE")
})

test("pick: demo takes the first option of the cart", () => {
  const none = { APM: null, COURIER: null, DIGITAL: null }
  assert.deepEqual(pickShippingOption({ type: "APM", mapping: none, available: OPTIONS, demo: true }), { ok: true, id: "so_locker", fallback: true })
  assert.deepEqual(pickShippingOption({ type: "APM", mapping: { ...none, APM: "so_gone" }, available: OPTIONS, demo: true }), { ok: true, id: "so_locker", fallback: true })
  const empty = pickShippingOption({ type: "APM", mapping: none, available: [], demo: true })
  assert.equal(empty.ok === false && empty.code, "NO_SHIPPING_OPTION")
})

test("offered: the mapped deliveries the cart can use; demo offers a locker", () => {
  assert.deepEqual(offeredDeliveries({ APM: "so_locker", COURIER: "so_gone", DIGITAL: null }, OPTIONS, false), [{ type: "APM", optionId: "so_locker" }])
  assert.deepEqual(offeredDeliveries({ APM: null, COURIER: null, DIGITAL: null }, OPTIONS, false), [])
  assert.deepEqual(offeredDeliveries({ APM: null, COURIER: null, DIGITAL: null }, OPTIONS, true), [{ type: "APM", optionId: "so_locker" }])
})

test("shipping method data: the locker as machine_id, nothing for a courier", () => {
  assert.deepEqual(shippingMethodData("APM", "KRA01M"), { inpost_pay: true, inpost_pay_delivery_type: "APM", machine_id: "KRA01M", machine_name: "KRA01M" })
  assert.deepEqual(shippingMethodData("COURIER", null), { inpost_pay: true, inpost_pay_delivery_type: "COURIER" })
  assert.equal(safeLockerCode("kra01m"), "KRA01M")
  assert.equal(safeLockerCode("POP-WAW1"), "POP-WAW1")
  assert.equal(safeLockerCode("<script>"), null)
})

const CART = {
  id: "cart_1",
  currency_code: "pln",
  total: 135.99,
  item_total: 123,
  item_tax_total: 23,
  original_item_total: 146,
  original_item_tax_total: 27.3,
  items: [
    { id: "cali_1", variant_id: "variant_1", product_title: "Krem", variant_title: "50 ml", product_handle: "krem", thumbnail: "https://cdn.example.com/k.png", quantity: 2, total: 123, tax_total: 23, original_total: 146, original_tax_total: 27.3, variant_barcode: "5901234123457" },
  ],
  promotions: [{ code: "WELCOME" }, { code: "WELCOME" }, null],
}

test("basket: summary, delivery and products as InPost reads them", () => {
  const p = basketPayload(CART, { deliveries: [{ type: "APM", gross: 12.99 }], shippingVatRate: 23, storefrontUrl: "https://shop.example.com", expiresAt: new Date("2026-10-19T10:00:00.000Z"), deliveryDate: new Date("2026-10-20T10:00:00.000Z") }) as any
  assert.deepEqual(p.summary.basket_base_price, { net: 118.7, gross: 146, vat: 27.3 })
  assert.deepEqual(p.summary.basket_final_price, { net: 100, gross: 123, vat: 23 })
  assert.equal(p.summary.currency, "PLN")
  assert.deepEqual(p.summary.payment_type, [])
  assert.equal(p.summary.basket_expiration_date, "2026-10-19T10:00:00.000Z")
  assert.deepEqual(p.delivery, [{ delivery_type: "APM", delivery_date: "2026-10-20T10:00:00.000Z", delivery_price: { net: 10.56, gross: 12.99, vat: 2.43 } }])
  assert.equal(p.products.length, 1)
  assert.equal(p.products[0].product_id, "variant_1")
  assert.equal(p.products[0].product_link, "https://shop.example.com/products/krem")
  assert.equal(p.products[0].ean, "5901234123457")
  assert.deepEqual(p.products[0].final_price, { net: 50, gross: 61.5, vat: 11.5 })
  assert.deepEqual(p.products[0].quantity, { quantity: 2, quantity_type: "INTEGER", quantity_unit: "pcs" })
  assert.deepEqual(p.promo_codes, [{ name: "WELCOME", promo_code_value: "WELCOME" }])
})

test("basket: helpers", () => {
  assert.equal(currencySupported("PLN"), true)
  assert.equal(currencySupported("eur"), false)
  assert.equal(cartTotalMinor(CART), 13599)
  assert.deepEqual(lineItemFor(CART, "variant_1"), { id: "cali_1", quantity: 2 })
  assert.deepEqual(lineItemFor(CART, "cali_1"), { id: "cali_1", quantity: 2 })
  assert.equal(lineItemFor(CART, "variant_9"), null)
  assert.deepEqual(price(10.005, 1.874), { net: 8.14, gross: 10.01, vat: 1.87 })
  assert.deepEqual(priceFromRate(0, 23), { net: 0, gross: 0, vat: 0 })
})
