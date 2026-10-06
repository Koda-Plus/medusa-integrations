/**
 * From Medusa records to template data: who gets no e-mail, the language of
 * each recipient, product lines, totals, shipments with tracking, password
 * reset links, carts, negotiation amounts, and anonymized previews.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addressLines,
  anonymize,
  cartData,
  currencyDigits,
  lineItem,
  negotiationData,
  orderData,
  orderLocale,
  orderSkipReason,
  resetData,
  shipmentData,
  trackingUrl,
  welcomeData,
  welcomeSkipReason,
  type OrderRecord,
} from "../src/modules/emails/lib/data.ts"
import { resolveOptions } from "../src/modules/emails/lib/options.ts"
import { LIVE } from "./helpers.ts"

const o = resolveOptions({ ...LIVE, defaultLocale: "en", trackingUrls: { inpost: "https://inpost.pl/sledzenie-przesylek?number={number}" } })

const order = (extra: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "order_1",
  display_id: 1042,
  email: "anna@example.com",
  currency_code: "pln",
  created_at: "2026-10-06T10:00:00Z",
  metadata: {},
  customer_id: "cus_1",
  total: 369,
  item_total: 340,
  shipping_total: 29,
  discount_total: 0,
  tax_total: 69,
  items: [
    { id: "li_1", product_title: "Wiertarka 18V", variant_title: "Default variant", variant_sku: "KS-ELN-18V", quantity: 2, unit_price: 120, total: 240 },
    { id: "li_2", title: "Rękawice", variant_title: "XL", variant_sku: null, quantity: 1, unit_price: 100 },
  ],
  shipping_address: { first_name: "Marta", last_name: "Wiśniewska", company: "Stolarnia Wiśniewski", address_1: "ul. Dębowa 7", postal_code: "00-950", city: "Warszawa", country_code: "PL" },
  shipping_methods: [{ name: "Kurier DPD" }],
  customer: { first_name: "Ania", metadata: {} },
  ...extra,
})

test("who gets no e-mail: no_notification, marketplace orders, orders without an address", () => {
  assert.equal(orderSkipReason(order(), o), null)
  assert.equal(orderSkipReason(order({ no_notification: true }), o), "no_notification")
  assert.equal(orderSkipReason(order({ metadata: { marketplace_order_ref: "allegro:123" } }), o), "marketplace")
  assert.equal(orderSkipReason(order({ email: "" }), o), "no_email")
  assert.equal(orderSkipReason(order({ metadata: { marketplace_order_ref: "" } }), o), null)
  assert.equal(orderSkipReason(order({ metadata: { source: "pos" } }), resolveOptions({ skipOrderMetadataKeys: ["source"] })), "marketplace")
})

test("the language of an order: its locale, then its metadata, then the customer's, then the default", () => {
  assert.equal(orderLocale(order({ locale: "pl-PL" }), o), "pl-PL")
  assert.equal(orderLocale(order({ locale: "de-DE", metadata: { language: "pl" } }), o), "pl")
  assert.equal(orderLocale(order({ customer: { metadata: { locale: "pl_PL" } } }), o), "pl_PL")
  assert.equal(orderLocale(order(), o), "en")
})

test("order data: the number, the person from the address, lines with variants that say something, totals as numbers", () => {
  const d = orderData(order({ custom_display_id: "KS-2026-04812", locale: "pl-PL" }), o)
  assert.equal(d.order_number, "KS-2026-04812")
  assert.equal(d.customer_name, "Marta")
  assert.equal(d.company_name, "Stolarnia Wiśniewski")
  assert.equal(d.country_code, "pl")
  assert.equal(d.shipping_method, "Kurier DPD")
  assert.deepEqual(d.items?.[0], { title: "Wiertarka 18V", variant: null, sku: "KS-ELN-18V", quantity: 2, unit_price: 120, total: 240 })
  assert.deepEqual(d.items?.[1], { title: "Rękawice", variant: "XL", sku: null, quantity: 1, unit_price: 100, total: 100 })
  assert.deepEqual([d.items_total, d.shipping_total, d.tax_total, d.total], [340, 29, 69, 369])
  assert.deepEqual(addressLines(order().shipping_address), ["Stolarnia Wiśniewski", "Marta Wiśniewska", "ul. Dębowa 7", "00-950 Warszawa"])
  assert.equal(orderData(order({ display_id: null, custom_display_id: null }), o).order_number, null)
  assert.equal(lineItem({ title: "  " }), null)
  assert.equal(lineItem({ title: "X", quantity: { value: "3" }, unit_price: "2.5" })?.total, 7.5)
})

test("a shipment: tracking from the label or the provider's template, its items, partial or complete", () => {
  const f = {
    id: "ful_1",
    shipped_at: "2026-10-07T08:00:00Z",
    provider_id: "inpost_inpost",
    labels: [{ tracking_number: "6200111", tracking_url: "" }, { tracking_number: "ABC", tracking_url: "https://carrier.example.com/ABC" }, { tracking_number: " " }],
    items: [{ title: "Wiertarka", sku: "KS-ELN-18V", quantity: 2, line_item_id: "li_1" }],
  }
  const d = shipmentData(order(), f, o)
  assert.deepEqual(d.tracking, [
    { number: "6200111", url: "https://inpost.pl/sledzenie-przesylek?number=6200111", carrier: null },
    { number: "ABC", url: "https://carrier.example.com/ABC", carrier: null },
  ])
  assert.equal(d.partial, true, "one of three pieces is still to come")
  assert.equal(d.shipped_items?.[0].title, "Wiertarka 18V")
  assert.equal(d.shipped_items?.[0].quantity, 2)
  const all = shipmentData(order({ fulfillments: [{ id: "ful_0", shipped_at: "2026-10-06T12:00:00Z", items: [{ quantity: 1, line_item_id: "li_2" }] }] }), f, o)
  assert.equal(all.partial, false, "with the earlier parcel everything is on its way")
  assert.equal(trackingUrl("X", "javascript:x", "dpd_dpd", o), null)
})

test("welcome: registered accounts only, the language from the customer's metadata", () => {
  assert.equal(welcomeSkipReason(null), "not_found")
  assert.equal(welcomeSkipReason({ email: "a@example.com", has_account: false }), "guest")
  assert.equal(welcomeSkipReason({ email: "x", has_account: true }), "no_email")
  assert.equal(welcomeSkipReason({ email: "a@example.com", has_account: true }), null)
  const d = welcomeData({ first_name: "Marek", company_name: "Stolarnia", created_at: "2026-10-01T10:00:00Z", metadata: { locale: "pl" } }, o)
  assert.deepEqual(d, { locale: "pl", customer_name: "Marek", company_name: "Stolarnia", customer_since: "2026-10-01T10:00:00.000Z" })
})

test("password reset: the storefront link for customers, the admin link for users, nothing without a page", () => {
  const c = resetData({ email: "anna@example.com", actorType: "customer", token: "t/ok+en", metadata: { locale: "pl" } }, o, null)
  assert.equal(c?.reset_url, "https://shop.example.com/reset-password?token=t%2Fok%2Ben&email=anna%40example.com")
  assert.equal(c?.locale, "pl")
  assert.equal(c?.expires_minutes, 15)
  const u = resetData({ email: "admin@example.com", actorType: "user", token: "t" }, o, "https://api.example.com/app/reset-password?token={token}&email={email}")
  assert.equal(u?.reset_url, "https://api.example.com/app/reset-password?token=t&email=admin%40example.com")
  assert.equal(u?.actor, "user")
  assert.equal(resetData({ email: "admin@example.com", actorType: "user", token: "t" }, o, null), null)
  assert.equal(resetData({ email: "v@example.com", actorType: "vendor", token: "t" }, o, null), null)
  assert.equal(resetData({ email: "anna@example.com", actorType: "customer", token: "t" }, resolveOptions({}), null), null, "no storefrontUrl, no link")
})

test("a cart: lines, the value, the language of the cart", () => {
  const d = cartData({ id: "cart_1", currency_code: "EUR", locale: "pl-PL", item_total: 50, items: [{ title: "Lamp", quantity: 2, unit_price: 25 }], shipping_address: { first_name: "Ewa", country_code: "DE" } }, o)
  assert.deepEqual(d, {
    locale: "pl-PL",
    cart_id: "cart_1",
    currency_code: "eur",
    customer_name: "Ewa",
    items: [{ title: "Lamp", variant: null, sku: null, quantity: 2, unit_price: 25, total: 50 }],
    cart_total: 50,
    country_code: "de",
  })
})

test("negotiation amounts: price_amount in minor units first, then a price string in major units", () => {
  /* The data of the Koda Plus negotiations plugin: a decimal string and the same amount in minor units. */
  const e = { id: "neg_1", ref: "NEG-2026-1001", status: "counter_offered", subject: "variant", customer_id: "cus_1", qty: 12, price: "469.00", price_amount: 46900, currency_code: "pln", sku: "CH-1" }
  assert.equal(negotiationData(e, {}, o).price, 469)
  assert.equal(negotiationData({ ...e, price: "1200", price_amount: 1200, currency_code: "jpy" }, {}, o).price, 1200, "no decimals in yen")
  assert.equal(negotiationData({ ...e, price: "38.500", price_amount: 38500, currency_code: "kwd" }, {}, o).price, 38.5, "three in dinars")
  assert.equal(negotiationData({ ...e, price_amount: undefined }, {}, o).price, 469, "the string alone is read in major units")
  assert.equal(negotiationData({ ...e, price: null, price_amount: null }, {}, o).price, null)
  assert.equal(negotiationData({ ...e, price: "-5", price_amount: undefined }, {}, o).price, null)
  assert.equal(currencyDigits("kwd"), 3)
  assert.equal(currencyDigits("???"), 2)
})

test("negotiation amounts: a numeric price without price_amount follows negotiationAmounts, major by default", () => {
  const e = { id: "neg_1", qty: 2, price: 469, currency_code: "pln" }
  assert.equal(o.negotiationAmounts, "major")
  assert.equal(negotiationData(e, {}, o).price, 469)
  assert.equal(negotiationData({ ...e, price: 46900 }, {}, resolveOptions({ negotiationAmounts: "minor" })).price, 469)
})

test("negotiation data: the person, the product, a cart priced as a whole, the validity of an offer", () => {
  const e = { id: "neg_1", ref: "NEG-2026-1001", status: "counter_offered", subject: "variant", customer_id: "cus_1", qty: 12, price: "469.00", price_amount: 46900, currency_code: "PLN", sku: "CH-1", expires_at: "2026-10-14T10:00:00.000Z" }
  const d = negotiationData(e, { customer: { first_name: "Jan", metadata: { locale: "pl" } }, productTitle: "Fotel", variantTitle: "Default variant", sku: null }, o)
  assert.deepEqual(
    [d.locale, d.customer_name, d.product_title, d.variant_title, d.quantity, d.ref, d.subject, d.sku, d.currency_code, d.expires_at],
    ["pl", "Jan", "Fotel", null, 12, "NEG-2026-1001", "variant", "CH-1", "pln", "2026-10-14T10:00:00.000Z"],
  )
  const cart = negotiationData({ ...e, subject: "cart", product_id: null, variant_id: null, qty: 1, price: "4500.00", price_amount: 450000 }, {}, o)
  assert.equal(cart.subject, "cart")
  assert.equal(cart.quantity, null, "a cart price has no quantity of its own")
  assert.equal(cart.price, 4500)
  assert.equal(negotiationData({ ...e, subject: "something else" }, {}, o).subject, null)
})

test("previews from the store's data keep the products and amounts, never the person", () => {
  const d = anonymize(orderData(order(), o), "pl")
  assert.notEqual(d.customer_name, "Marta")
  assert.notEqual(d.company_name, "Stolarnia Wiśniewski")
  assert.ok(!(d.shipping_address ?? []).some((l) => l.includes("Dębowa") || l.includes("Wiśniewska")))
  assert.equal(d.items?.[0].title, "Wiertarka 18V")
  assert.equal(d.total, 369)
})
