/**
 * Options: lenient on purpose (a typo never stops Medusa), writers off by
 * default in live mode, demo without a token, the settings a person saves
 * over the options. References: the same parser and tests as the other Koda
 * Plus integrations.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { missingOptions, referenceFor, resolveOptions } from "../src/modules/inpost/lib/options.ts"
import { normalizeReferences, normalizeReview, pickText } from "../src/modules/inpost/lib/references.ts"
import { effectiveSettings, readStoredSettings, validateSettingsInput } from "../src/modules/inpost/lib/settings.ts"
import { writerState } from "../src/modules/inpost/lib/writers.ts"

test("demo mode without a token; live mode needs the token and the organization", () => {
  const none = resolveOptions(undefined)
  assert.equal(none.demo, true)
  assert.equal(none.demoReason, "no_token")
  assert.deepEqual(missingOptions(none), [])
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
  assert.deepEqual(resolveOptions({ apiToken: "x" }).writers, { shipment: false, fulfillmentStatus: false })
  assert.deepEqual(resolveOptions({}).writers, { shipment: true, fulfillmentStatus: true })
  assert.deepEqual(resolveOptions({ demo: true, shipmentWriter: false }).writers, { shipment: false, fulfillmentStatus: true })
  assert.equal(resolveOptions({ apiToken: "x", shipmentWriter: "true" }).writers.shipment, true)
  const broken = resolveOptions({ apiToken: "x", shipmentWriter: "yes please" as never })
  assert.equal(broken.writers.shipment, false)
  assert.ok(broken.problems.some((p) => p.startsWith("shipmentWriter")))
  assert.equal(resolveOptions({}).autoCreate, false)
  const armed = writerState("shipment", { shipment: true, fulfillmentStatus: false }, { on: true, updatedBy: "user_1", updatedAt: null })
  assert.equal(armed.armed, true)
  assert.equal(writerState("fulfillmentStatus", { shipment: true, fulfillmentStatus: false }, { on: true, updatedBy: null, updatedAt: null }).armed, false, "the option wins over the toggle")
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

/* ------------------------------------------------------------------ */
/* References: the tests of the OLX package, the same parser            */
/* ------------------------------------------------------------------ */
test("references: entries without a name or an https URL are dropped, parts are cleaned, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Koda Supply",
      url: "https://supply.example.com",
      description: { en: "Tools and supplies", pl: "Narzędzia i materiały" },
      metrics: [{ label: { en: "adverts", pl: "ogłoszeń" }, value: "1 900" }, { label: "broken" }],
      links: [{ label: "Product", url: "https://supply.example.com/p/1" }, { label: "Insecure", url: "http://x.pl" }],
    },
    { name: "No URL" },
    { name: "Plain http", url: "http://shop.pl" },
    { name: "", url: "https://shop.pl" },
    { name: "Duplicate", url: "https://supply.example.com" },
    "not an object",
    { name: "Same text", url: "https://shop.example.com", description: "Same in both" },
  ])
  assert.equal(refs.length, 2)
  assert.equal(refs[0].soon, false)
  assert.equal(refs[0].metrics.length, 1)
  assert.equal(refs[0].links.length, 1)
  assert.deepEqual(refs[1].description, { en: "Same in both", pl: "Same in both" })
  assert.deepEqual(normalizeReferences("nope"), [])
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.equal(resolveOptions({ references: [{ name: "A", url: "https://a.pl" }] }).references.length, 1)
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 9, scale: 10, source: "Google" })?.scale, 10)
  assert.equal(normalizeReview({ rating: 5, source: "Clutch", url: "http://clutch.co" })?.url, null)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
  assert.equal(normalizeReview("5 stars"), null)
  const [withReview, without] = normalizeReferences([
    { name: "A", url: "https://a.pl", review: { rating: 5, source: "Clutch" } },
    { name: "B", url: "https://b.pl", review: { rating: "great" } },
  ])
  assert.equal(withReview.review?.rating, 5)
  assert.equal(without.review, null)
})

test("references: the admin language with a fallback to the other one", () => {
  assert.equal(pickText({ en: "Tools", pl: "Narzędzia" }, "pl"), "Narzędzia")
  assert.equal(pickText({ en: "Tools", pl: "Narzędzia" }, "en-US"), "Tools")
  assert.equal(pickText({ en: "Only English" }, "pl"), "Only English")
  assert.equal(pickText({ pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(pickText(null, "pl"), "")
})

test("references: a store that starts soon needs only its name, a live one still needs an https URL", () => {
  const refs = normalizeReferences([
    { name: "Soon, no address", soon: true, description: "Opens in spring" },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Soon, insecure address", soon: true, url: "http://soon.example.com" },
    { name: "Live, no address" },
    { name: "Live, insecure address", url: "http://live.example.com" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Soon, insecure address", soon: true, url: null },
    ],
  )
  assert.deepEqual(refs[0].description, { en: "Opens in spring", pl: "Opens in spring" })
  assert.equal(normalizeReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
})

test("references: the since date of an older config is ignored, never an error", () => {
  const refs = normalizeReferences([
    { name: "Live", url: "https://a.pl", since: "2026-04" },
    { name: "Soon", soon: true, since: { not: "a month" } },
  ])
  assert.equal(refs.length, 2)
  for (const r of refs) assert.equal("since" in r, false)
  assert.equal(refs[0].url, "https://a.pl/")
  assert.equal(refs[1].soon, true)
})
