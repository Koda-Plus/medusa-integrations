/**
 * Delivery both ways: the shipping option of each marketplace delivery type,
 * the tracking numbers read from Medusa fulfillments, and what happens with
 * them (demo records, the writer sends, off notes, nothing twice).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeMapping, shippingOptionFor, trackingDecision, trackingNumbersOf, unsentNumbers } from "../src/modules/vonhalsky/lib/shipping.ts"
import { settingsFrom } from "../src/modules/vonhalsky/lib/store.ts"

test("mapping: only known delivery types and shipping option ids", () => {
  assert.deepEqual(normalizeMapping({ APM: "so_1", COURIER: "so_2", DIGITAL: "so_3" }), { APM: "so_1", COURIER: "so_2" })
  assert.deepEqual(normalizeMapping({ APM: "not an id", COURIER: 5 }), { APM: null, COURIER: null })
  assert.deepEqual(normalizeMapping(null), { APM: null, COURIER: null })
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
  assert.deepEqual(unsentNumbers(["111", "222"], ["111"]), ["222"])
  assert.deepEqual(unsentNumbers(["111"], null), ["111"])
})

test("tracking: demo records, the writer sends, off only notes, nothing twice", () => {
  const base = { imported: true, numbers: ["111"], sent: [] as string[], demo: false, sendTracking: true }
  assert.deepEqual(trackingDecision(base), { kind: "send", numbers: ["111"] })
  assert.deepEqual(trackingDecision({ ...base, demo: true, sendTracking: false }), { kind: "record", numbers: ["111"] })
  assert.deepEqual(trackingDecision({ ...base, sendTracking: false }), { kind: "off", numbers: ["111"] })
  assert.deepEqual(trackingDecision({ ...base, sent: ["111"] }), { kind: "none", reason: "all_sent" })
  assert.deepEqual(trackingDecision({ ...base, numbers: [] }), { kind: "none", reason: "no_numbers" })
  assert.deepEqual(trackingDecision({ ...base, imported: false }), { kind: "none", reason: "not_imported" })
})

test("settings: what the admin saved wins over the options", () => {
  const o = { markupPercent: 5, salesChannelId: "sc_option", regionId: null, autoImport: false }
  assert.deepEqual(settingsFrom([], o), { pricing: { markupPercent: 5 }, orders: { salesChannelId: "sc_option", regionId: null, autoImport: false }, shipping: { APM: null, COURIER: null } })
  const saved = settingsFrom(
    [
      { key: "pricing", value: { markupPercent: 12 } },
      { key: "orders", value: { salesChannelId: "sc_saved", regionId: "reg_1", autoImport: true } },
      { key: "shipping", value: { APM: "so_1" } },
    ],
    o,
  )
  assert.equal(saved.pricing.markupPercent, 12)
  assert.equal(saved.orders.salesChannelId, "sc_saved")
  assert.equal(saved.orders.regionId, "reg_1")
  assert.equal(saved.orders.autoImport, true)
  assert.equal(saved.shipping.APM, "so_1")
  assert.equal(settingsFrom([{ key: "pricing", value: { markupPercent: 999 } }], o).pricing.markupPercent, 5, "an invalid saved markup falls back")
})
