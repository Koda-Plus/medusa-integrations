/**
 * Confirming a basket: the phone and its mask, the sample buyer of the
 * demo (nothing real, the number never in the e-mail), the idempotency
 * decision, the money in minor units, the order body InPost sends, and the
 * proof that keeps Store API sessions from being authorized.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { confirmDecision, demoBuyer, fromMinor, maskPhone, normalizePhone, toMinor } from "../src/modules/inpostpay/lib/confirm.ts"
import { parseInpostOrder } from "../src/modules/inpostpay/lib/order-input.ts"
import { InpostPayFlowError } from "../src/modules/inpostpay/lib/errors.ts"
import { proofSecret, proofValid, sessionProof } from "../src/modules/inpostpay/lib/proof.ts"

test("phone: Polish numbers in every spelling are the same", () => {
  for (const v of ["600 000 000", "+48600000000", "0048 600-000-000", "600000000"]) assert.deepEqual(normalizePhone(v), { country_prefix: "+48", phone: "600000000" })
  assert.deepEqual(normalizePhone("600000000", "+420"), { country_prefix: "+420", phone: "600000000" })
  assert.deepEqual(normalizePhone("+4915112345678"), { country_prefix: "+491", phone: "5112345678" })
  assert.equal(normalizePhone("12"), null)
  assert.equal(normalizePhone("abc"), null)
  assert.equal(normalizePhone(undefined), null)
})

test("phone: masked like InPost, two digits on each side", () => {
  assert.equal(maskPhone("600000000"), "60*****00")
  assert.equal(maskPhone("123"), "***")
})

test("demo buyer: sample data only, on example.com, without the number", () => {
  const b = demoBuyer({ country_prefix: "+48", phone: "600123456" })
  assert.match(b.email, /^inpostpay-demo-[0-9a-f]{10}@example\.com$/)
  assert.ok(!b.email.includes("600123456"))
  assert.equal(b.email, demoBuyer({ country_prefix: "+48", phone: "600123456" }).email, "the same phone gives the same buyer")
  assert.notEqual(b.email, demoBuyer({ country_prefix: "+48", phone: "600123457" }).email)
  assert.match(b.last_name, /symulacja/)
  assert.equal(b.address.country_code, "pl")
  assert.match(b.locker, /^[A-Z]{2,6}\d{1,5}[A-Z]{0,5}$/)
})

test("idempotency: an ordered basket returns its order, refused ones stay refused", () => {
  assert.deepEqual(confirmDecision({ status: "ordered", order_id: "order_1" }), { action: "return_order", orderId: "order_1" })
  assert.deepEqual(confirmDecision({ status: "failed", order_id: "order_1" }), { action: "return_order", orderId: "order_1" })
  assert.deepEqual(confirmDecision({ status: "created", order_id: null }), { action: "place" })
  assert.deepEqual(confirmDecision({ status: "linked", order_id: null }), { action: "place" })
  assert.deepEqual(confirmDecision({ status: "failed", order_id: null }), { action: "place" })
  assert.equal(confirmDecision({ status: "rejected", order_id: null }).action, "refuse")
  assert.equal(confirmDecision({ status: "unbound", order_id: null }).action, "refuse")
})

test("money: minor units both ways, rounding half up", () => {
  assert.equal(toMinor(199.99), 19999)
  assert.equal(toMinor("1.005"), 101)
  assert.equal(toMinor(0), 0)
  assert.equal(toMinor("x"), null)
  assert.equal(fromMinor(19999), "199.99")
  assert.equal(fromMinor(5), "0.05")
  assert.equal(fromMinor(null), null)
})

const ORDER = {
  order_details: { basket_id: "ipbsk_1", currency: "PLN", basket_price: { net: 81.3, gross: 100, vat: 18.7 }, payment_type: "BLIK_CODE" },
  account_info: { name: "Anna", surname: "Testowa", phone_number: { country_prefix: "+48", phone: "600000000" }, mail: "anna@example.com", client_address: { country_code: "PL", city: "Poznań", address: "Testowa 100", postal_code: "00-000" } },
  delivery: { delivery_type: "APM", delivery_point: "pop-waw1", delivery_codes: ["PWW"] },
}

test("order body: the buyer, the locker and the price InPost charged", () => {
  const p = parseInpostOrder(ORDER)
  assert.equal(p.basketId, "ipbsk_1")
  assert.equal(p.buyer.email, "anna@example.com")
  assert.equal(p.buyer.first_name, "Anna")
  assert.equal(p.buyer.phone, "+48600000000")
  assert.equal(p.buyer.address.city, "Poznań")
  assert.equal(p.buyer.address.country_code, "pl")
  assert.deepEqual(p.delivery, { type: "APM", point: "POP-WAW1" })
  assert.deepEqual(p.payment, { status: "UNPAID", type: "BLIK_CODE" })
  assert.equal(p.expectedTotalMinor, 10000)
})

test("order body: the courier address, cash on delivery, refusals", () => {
  const courier = parseInpostOrder({
    ...ORDER,
    order_details: { ...ORDER.order_details, payment_type: "CASH_ON_DELIVERY" },
    delivery: { delivery_type: "COURIER", delivery_address: { name: "Jan Przykładowy", address: "Kwiatowa 5", city: "Kraków", postal_code: "30-001", country_code: "PL" } },
  })
  assert.equal(courier.buyer.first_name, "Jan")
  assert.equal(courier.buyer.last_name, "Przykładowy")
  assert.equal(courier.buyer.address.address_1, "Kwiatowa 5")
  assert.deepEqual(courier.payment, { status: "COD", type: "CASH_ON_DELIVERY" })
  const code = (body: Record<string, any>) => {
    try {
      parseInpostOrder(body)
      return null
    } catch (e) {
      return e instanceof InpostPayFlowError ? e.code : "other"
    }
  }
  assert.equal(code({ ...ORDER, order_details: { ...ORDER.order_details, basket_id: "" } }), "BASKET_ID_MISSING")
  assert.equal(code({ ...ORDER, order_details: { ...ORDER.order_details, currency: "EUR" } }), "CURRENCY_NOT_SUPPORTED")
  assert.equal(code({ ...ORDER, delivery: { delivery_type: "DRONE" } }), "DELIVERY_TYPE_INVALID")
  assert.equal(code({ ...ORDER, delivery: { delivery_type: "APM" } }), "DELIVERY_POINT_INVALID")
  assert.equal(code({ ...ORDER, account_info: { ...ORDER.account_info, mail: "nope" } }), "EMAIL_INVALID")
})

test("proof: only the plugin's own sessions are trusted", () => {
  const secret = proofSecret({ sessionSecret: "", clientSecret: "client-secret" })
  assert.equal(secret, proofSecret({ sessionSecret: "", clientSecret: "client-secret" }), "the module and the provider agree")
  assert.notEqual(secret, proofSecret({ sessionSecret: "", clientSecret: "other" }))
  assert.equal(proofSecret({ sessionSecret: "stable", clientSecret: "x" }), "stable")
  const data = { basket_id: "ipbsk_1", cart_id: "cart_1", amount_minor: 10000, demo: false }
  const proof = sessionProof(secret, data)
  assert.equal(proofValid(secret, { ...data, proof }), true)
  assert.equal(proofValid(secret, { ...data, proof, amount_minor: 1 }), false)
  assert.equal(proofValid(secret, { ...data, proof, cart_id: "cart_2" }), false)
  assert.equal(proofValid(secret, { ...data, proof, demo: true }), false)
  assert.equal(proofValid(secret, { ...data }), false)
  assert.equal(proofValid("another-secret", { ...data, proof }), false)
  assert.equal(proofValid(secret, null), false)
})
