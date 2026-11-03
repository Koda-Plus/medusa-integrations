/**
 * Delivery both ways: the shipping option of each marketplace delivery type,
 * the tracking numbers read from Medusa fulfillments (how they compare with
 * the marketplace's parcels is `trackingStatus`, tested with the offer sync),
 * and the settings the admin saved winning over the options.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeMapping, shippingOptionFor, trackingNumbersOf } from "../src/modules/vonhalsky/lib/shipping.ts"
import { categoryMapOf, offerDefaultsOf, settingsFrom } from "../src/modules/vonhalsky/lib/store.ts"

test("mapping: only known delivery types and shipping option ids", () => {
  assert.deepEqual(normalizeMapping({ APM: "so_1", COURIER: "so_2", DIGITAL: "so_3" }), { APM: "so_1", COURIER: "so_2" })
  assert.deepEqual(normalizeMapping({ APM: "not an id", COURIER: 5 }), { APM: null, COURIER: null })
  assert.deepEqual(normalizeMapping(null), { APM: null, COURIER: null })
  assert.deepEqual(normalizeMapping(["so_1"]), { APM: null, COURIER: null })
})

test("mapping: the mapped option, the fallback, and an unknown delivery type", () => {
  const m = { APM: "so_apm", COURIER: "so_courier" }
  assert.equal(shippingOptionFor("APM", m), "so_apm")
  assert.equal(shippingOptionFor("COURIER", m), "so_courier")
  assert.equal(shippingOptionFor("COURIER", { APM: "so_apm", COURIER: null }, "so_first"), "so_first")
  assert.equal(shippingOptionFor("COURIER", { APM: "so_apm", COURIER: null }), null)
  assert.equal(shippingOptionFor("UNKNOWN", { APM: null, COURIER: "so_courier" }), "so_courier")
  assert.equal(shippingOptionFor(null, { APM: null, COURIER: null }, "so_first"), "so_first")
})

test("tracking: numbers of fulfillments that are not canceled, once each", () => {
  const numbers = trackingNumbersOf([
    { labels: [{ tracking_number: " 111 " }, { tracking_number: "222" }] },
    { canceled_at: "2026-10-18T10:00:00Z", labels: [{ tracking_number: "333" }] },
    { labels: [{ tracking_number: "222" }, { tracking_number: "" }, null] },
    null,
  ])
  assert.deepEqual(numbers, ["111", "222"])
  assert.deepEqual(trackingNumbersOf(null), [])
  assert.deepEqual(trackingNumbersOf([{ labels: [{ tracking_number: "9".repeat(65) }] }]), [], "a number longer than 64 characters is not a parcel number")
})

const OPTIONS = { markupPercent: 5, salesChannelId: "sc_option", regionId: null, autoImport: false, daysToShip: 2, syncPriceStock: true }

test("settings: nothing saved means the options and the defaults", () => {
  assert.deepEqual(settingsFrom([], OPTIONS), {
    pricing: { markupPercent: 5 },
    orders: { salesChannelId: "sc_option", regionId: null, autoImport: false },
    shipping: { APM: null, COURIER: null },
    categories: {},
    offerDefaults: { daysToShip: 2, returnPolicy: "", complaintPolicy: "", syncPriceStock: true },
  })
})

test("settings: what the admin saved wins over the options", () => {
  const saved = settingsFrom(
    [
      { key: "pricing", value: { markupPercent: 12 } },
      { key: "orders", value: { salesChannelId: "sc_saved", regionId: "reg_1", autoImport: true } },
      { key: "shipping", value: { APM: "so_1" } },
      { key: "categories", value: { pcat_1: "leaf-1" } },
      { key: "offer_defaults", value: { daysToShip: 5, returnPolicy: " 30 dni na zwrot ", complaintPolicy: "Reklamacje: reklamacje@example.com", syncPriceStock: false } },
    ],
    OPTIONS,
  )
  assert.equal(saved.pricing.markupPercent, 12)
  assert.equal(saved.orders.salesChannelId, "sc_saved")
  assert.equal(saved.orders.regionId, "reg_1")
  assert.equal(saved.orders.autoImport, true)
  assert.equal(saved.shipping.APM, "so_1")
  assert.deepEqual(saved.categories, { pcat_1: "leaf-1" })
  assert.deepEqual(saved.offerDefaults, { daysToShip: 5, returnPolicy: "30 dni na zwrot", complaintPolicy: "Reklamacje: reklamacje@example.com", syncPriceStock: false })
  assert.equal(settingsFrom([{ key: "pricing", value: { markupPercent: 999 } }], OPTIONS).pricing.markupPercent, 5, "an invalid saved markup falls back")
})

test("settings: the category map keeps only Medusa category ids mapped to marketplace ids", () => {
  assert.deepEqual(categoryMapOf({ pcat_1: "leaf-1", pcat_2: 5, cat_3: "leaf-3", pcat_4: "bad id!" }), { pcat_1: "leaf-1" })
  assert.deepEqual(categoryMapOf(["pcat_1"]), {})
  assert.deepEqual(categoryMapOf(null), {})
})

test("settings: offer defaults out of range fall back to the options", () => {
  const d = offerDefaultsOf({ daysToShip: 61, returnPolicy: 7, syncPriceStock: "no" }, { daysToShip: 3, syncPriceStock: true })
  assert.deepEqual(d, { daysToShip: 3, returnPolicy: "", complaintPolicy: "", syncPriceStock: true })
  assert.equal(offerDefaultsOf({ daysToShip: 0 }, { daysToShip: 3, syncPriceStock: true }).daysToShip, 0)
  assert.equal(offerDefaultsOf({ daysToShip: 1.5 }, { daysToShip: 3, syncPriceStock: true }).daysToShip, 3)
  assert.equal(offerDefaultsOf({ returnPolicy: "x".repeat(6000) }, { daysToShip: 3, syncPriceStock: true }).returnPolicy.length, 5000)
})
