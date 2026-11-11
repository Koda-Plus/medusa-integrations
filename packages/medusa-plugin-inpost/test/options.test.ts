/**
 * Options: lenient on purpose (a typo never stops Medusa), writers off by
 * default in live mode, demo without a token, the settings a person saves
 * over the options.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { missingOptions, referenceFor, resolveOptions } from "../src/modules/inpost/lib/options.ts"
import { effectiveSettings, readStoredSettings, validateSettingsInput } from "../src/modules/inpost/lib/settings.ts"
import { writerState } from "../src/modules/inpost/lib/writers.ts"

test("demo mode only with demo: true; without a token the plugin is not configured, never demo", () => {
  const none = resolveOptions(undefined)
  assert.equal(none.demo, false)
  assert.equal(none.demoReason, null)
  assert.deepEqual(missingOptions(none), ["apiToken", "organizationId"])
  assert.equal(resolveOptions({ demo: true }).demo, true)
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  const live = resolveOptions({ apiToken: "t".repeat(40) })
  assert.equal(live.demo, false)
  assert.deepEqual(missingOptions(live), ["organizationId"])
  const off = resolveOptions({ demo: "false" })
  assert.equal(off.demo, false)
  assert.deepEqual(missingOptions(off), ["apiToken", "organizationId"])
  assert.equal(resolveOptions({ demo: true, apiToken: "x" }).demoReason, "option")
  assert.equal(resolveOptions({ organizationId: "12a" }).organizationId, "")
  assert.equal(resolveOptions({ organizationId: 12345 }).organizationId, "12345")
})

test("writers: off by default in live mode, on in demo mode, only true opens them, false always wins", () => {
  assert.deepEqual(resolveOptions({ apiToken: "x" }).writers, { shipment: false, fulfillmentStatus: false, returns: false })
  assert.deepEqual(resolveOptions({}).writers, { shipment: false, fulfillmentStatus: false, returns: false })
  assert.deepEqual(resolveOptions({ demo: true }).writers, { shipment: true, fulfillmentStatus: true, returns: true })
  assert.deepEqual(resolveOptions({ demo: true, shipmentWriter: false }).writers, { shipment: false, fulfillmentStatus: true, returns: true })
  assert.equal(resolveOptions({ apiToken: "x", returnsWriter: "true" }).writers.returns, true)
  assert.equal(resolveOptions({ demo: true, returnsWriter: false }).writers.returns, false)
  assert.equal(resolveOptions({ apiToken: "x", shipmentWriter: "true" }).writers.shipment, true)
  const broken = resolveOptions({ apiToken: "x", shipmentWriter: "yes please" as never })
  assert.equal(broken.writers.shipment, false)
  assert.ok(broken.problems.some((p) => p.startsWith("shipmentWriter")))
  assert.equal(resolveOptions({}).autoCreate, false)
  const armed = writerState("shipment", { shipment: true, fulfillmentStatus: false, returns: false }, { on: true, updatedBy: "user_1", updatedAt: null })
  assert.equal(armed.armed, true)
  assert.equal(writerState("fulfillmentStatus", { shipment: true, fulfillmentStatus: false, returns: false }, { on: true, updatedBy: null, updatedAt: null }).armed, false, "the option wins over the toggle")
  assert.equal(writerState("returns", { shipment: true, fulfillmentStatus: true, returns: false }, { on: true, updatedBy: null, updatedAt: null }).armed, false)
})

test("defaults and broken values: sizes, labels, sending methods, weights, keys, limits, the webhook secret", () => {
  const d = resolveOptions({})
  assert.equal(d.defaultParcelSize, "medium")
  assert.equal(d.labelFormat, "A6")
  assert.deepEqual(d.sendingMethod, { locker: null, courier: null })
  assert.equal(d.referenceTemplate, "Order {display_id}")
  assert.equal(d.weightUnit, "g")
  assert.equal(d.defaultWeightKg, 1)
  assert.deepEqual(d.skipMetadataKeys, [])
  assert.equal(d.verifyLockers, true)
  assert.equal(d.pollEnabled, true)
  assert.equal(d.pollMaxAgeDays, 30)
  assert.equal(d.requestsPerMinute, 60)
  assert.equal(d.timeoutMs, 20000)
  assert.equal(d.pointsPerMinute, 60)
  assert.equal(d.webhookSecret, "")
  const o = resolveOptions({
    defaultParcelSize: "C",
    labelFormat: "a4",
    sendingMethod: { locker: "parcel_locker", courier: "teleport" },
    dropoffPoint: "ksp01m",
    weightUnit: "kg",
    defaultWeightKg: "2,5",
    skipMetadataKeys: "inpost_shipment, wz_numer ,inpost_shipment",
    requestsPerMinute: 100000,
    timeoutMs: 1,
    webhookSecret: "Short-And-Upper",
  })
  assert.equal(o.defaultParcelSize, "large")
  assert.equal(o.labelFormat, "A4")
  assert.deepEqual(o.sendingMethod, { locker: "parcel_locker", courier: null })
  assert.equal(o.dropoffPoint, "KSP01M")
  assert.equal(o.weightUnit, "kg")
  assert.equal(o.defaultWeightKg, 2.5)
  assert.deepEqual(o.skipMetadataKeys, ["inpost_shipment", "wz_numer"])
  assert.equal(o.requestsPerMinute, 600)
  assert.equal(o.timeoutMs, 3000)
  assert.equal(o.webhookSecret, "", "an unusable secret closes the webhook")
  assert.equal(o.webhookSecretInvalid, true)
  assert.deepEqual([...o.problems].sort(), ["sendingMethod.courier", "webhookSecret (at least 24 lowercase letters and digits)"].sort())
  assert.equal(resolveOptions({ webhookSecret: "a1b2c3d4e5f6a7b8c9d0e1f2a3" }).webhookSecret, "a1b2c3d4e5f6a7b8c9d0e1f2a3")
})

test("reference template: placeholders, the parcel number, clipped to 100", () => {
  assert.equal(referenceFor("Order {display_id}", { displayId: 1042, orderId: "order_1", fulfillmentId: "ful_1" }), "Order 1042")
  assert.equal(referenceFor("{order_id}", { displayId: null, orderId: "order_1", fulfillmentId: null, parcelNo: 3 }), "order_1/3")
  assert.equal(referenceFor("x".repeat(150), { displayId: 1, orderId: "o", fulfillmentId: null }).length, 100)
})

test("settings: a saved value wins over the option, per mode; the sender goes only with an e-mail and a phone", () => {
  const o = resolveOptions({ defaultParcelSize: "large", sender: { companyName: "Option Ltd", email: "a@example.com", phone: "000000003" } })
  const fromOptions = effectiveSettings(o, null)
  assert.equal(fromOptions.defaultParcelSize, "large")
  assert.equal(fromOptions.source.sender, "option")
  assert.equal(fromOptions.senderSent, true)
  assert.equal(fromOptions.senderAddress, false)
  const saved = effectiveSettings(o, readStoredSettings({ defaultParcelSize: "small", labelFormat: "A4", sender: { companyName: "Koda Supply" } }))
  assert.equal(saved.defaultParcelSize, "small")
  assert.equal(saved.labelFormat, "A4")
  assert.equal(saved.source.sender, "admin")
  assert.equal(saved.senderSent, false, "no e-mail and phone: InPost uses the organization's data")
  assert.equal(effectiveSettings(o, readStoredSettings({ sender: null })).source.sender, "option")
  assert.deepEqual(validateSettingsInput({ sender: { phone: "12", email: "nope", postCode: "1" }, labelFormat: "A5" }), { ok: false, errors: ["sender.email", "sender.phone", "sender.postCode", "labelFormat"] })
  const ok = validateSettingsInput({ sender: { companyName: "Koda Supply", phone: "+48 000 000 004", postCode: "00950" }, defaultParcelSize: "B" })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.value.sender?.phone, "000000004")
    assert.equal(ok.value.sender?.postCode, "00-950")
    assert.equal(ok.value.defaultParcelSize, "medium")
  }
})
