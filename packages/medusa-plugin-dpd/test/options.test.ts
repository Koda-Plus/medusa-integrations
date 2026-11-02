/**
 * Options: lenient on purpose (a typo never stops Medusa), three modes with
 * the sandbox by default, writers off outside demo mode, environment strings
 * read as booleans, numbers, lists and JSON, the settings a person saves
 * over the options.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { EU_COUNTRIES } from "../src/modules/dpd/lib/constants.ts"
import { canCallDpd, dpdServicesHost, missingOptions, resolveOptions, secretsOf } from "../src/modules/dpd/lib/options.ts"
import { DEMO_SEEDED_KEY, effectiveSettings, readStoredSettings, settingsKey, validateSettingsInput } from "../src/modules/dpd/lib/settings.ts"
import { readWriterSetting, writerSettingKey, writerState } from "../src/modules/dpd/lib/writers.ts"
import { PASSWORD, SANDBOX } from "./helpers.ts"

test("mode: demo only with demo: true; otherwise sandbox by default, live only when asked", () => {
  const none = resolveOptions(undefined)
  assert.equal(none.demo, false)
  assert.equal(none.mode, "sandbox")
  assert.deepEqual(missingOptions(none), ["login", "password", "masterFid"])
  assert.equal(canCallDpd(none), false)
  assert.equal(resolveOptions({ demo: true }).mode, "demo")
  assert.equal(resolveOptions({ demo: "true", mode: "live" }).mode, "demo", "demo wins over the mode")
  assert.deepEqual(missingOptions(resolveOptions({ demo: true })), [])
  assert.equal(resolveOptions({ mode: "live" }).mode, "live")
  assert.equal(resolveOptions({ mode: " LIVE " }).mode, "live")
  assert.equal(resolveOptions({ mode: "sandbox" }).mode, "sandbox")
  const typo = resolveOptions({ mode: "production" })
  assert.equal(typo.mode, "sandbox", "an unknown mode never means production")
  assert.ok(typo.problems.includes("mode (sandbox or live)"))
  const demoMode = resolveOptions({ mode: "demo" })
  assert.equal(demoMode.mode, "sandbox", "demo mode needs demo: true, not mode")
  assert.ok(demoMode.problems.includes("mode (demo mode needs demo: true)"))
  assert.ok(resolveOptions({ demo: "maybe" }).problems.includes("demo (true or false)"))
  assert.equal(resolveOptions({ demo: "maybe" }).demo, false)
})

test("credentials: login, password and a master FID; the payer FID defaults to the master FID", () => {
  const o = resolveOptions(SANDBOX)
  assert.deepEqual(missingOptions(o), [])
  assert.equal(canCallDpd(o), true)
  assert.equal(o.masterFid, 1000)
  assert.equal(o.payerFid, 1000)
  assert.equal(resolveOptions({ ...SANDBOX, payerFid: "2000" }).payerFid, 2000)
  const broken = resolveOptions({ ...SANDBOX, masterFid: "12a", payerFid: -5 })
  assert.equal(broken.masterFid, null)
  assert.equal(broken.payerFid, null)
  assert.deepEqual(missingOptions(broken), ["masterFid"])
  assert.ok(broken.problems.includes("masterFid (a whole number)"))
  assert.ok(broken.problems.includes("payerFid (a whole number)"))
  assert.equal(resolveOptions({ masterFid: 99999999999 }).masterFid, null, "beyond int32")
  assert.equal(dpdServicesHost(o), "https://dpdservicesdemo.dpd.com.pl")
  assert.equal(dpdServicesHost(resolveOptions({ ...SANDBOX, mode: "live" })), "https://dpdservices.dpd.com.pl")
  assert.equal(dpdServicesHost(resolveOptions({ demo: true })), null)
  assert.deepEqual(secretsOf(resolveOptions({ ...SANDBOX, pickupApiKey: "k".repeat(20) })), [PASSWORD, "k".repeat(20)], "logins and FIDs are not secrets")
})

test("writers: off outside demo mode, on in demo mode, only true opens them, false always wins", () => {
  assert.deepEqual(resolveOptions(SANDBOX).writers, { shipment: false, pickup: false, fulfillmentStatus: false })
  assert.deepEqual(resolveOptions({ demo: true }).writers, { shipment: true, pickup: true, fulfillmentStatus: true })
  assert.deepEqual(resolveOptions({ demo: true, pickupWriter: "false" }).writers, { shipment: true, pickup: false, fulfillmentStatus: true })
  assert.deepEqual(resolveOptions({ ...SANDBOX, shipmentWriter: "1", fulfillmentStatusWriter: "on" }).writers, { shipment: true, pickup: false, fulfillmentStatus: true })
  const broken = resolveOptions({ ...SANDBOX, pickupWriter: "please" })
  assert.equal(broken.writers.pickup, false)
  assert.ok(broken.problems.includes("pickupWriter (true or false)"))
  const allowed = { shipment: true, pickup: false, fulfillmentStatus: true }
  assert.equal(writerState("shipment", allowed, { on: true, updatedBy: "user_1", updatedAt: null }).armed, true)
  assert.equal(writerState("pickup", allowed, { on: true, updatedBy: null, updatedAt: null }).armed, false, "the option wins over the toggle")
  assert.equal(writerState("fulfillmentStatus", allowed, null).armed, false, "a toggle starts off")
  assert.equal(writerSettingKey("pickup", "sandbox"), "sandbox:writer:pickup")
  assert.notEqual(writerSettingKey("shipment", "sandbox"), writerSettingKey("shipment", "live"), "arming the sandbox never arms live")
  assert.deepEqual(readWriterSetting({ value: { on: true }, updated_by: "user_1", updated_at: "2026-11-02T10:00:00.000Z" }), { on: true, updatedBy: "user_1", updatedAt: "2026-11-02T10:00:00.000Z" })
  assert.equal(readWriterSetting({ value: { on: "yes" } })?.on, false)
  assert.equal(readWriterSetting(null), null)
})

test("defaults: EU countries, COD in Poland in PLN, A4 labels, grams, 90 days, waybill tracking", () => {
  const d = resolveOptions({})
  assert.deepEqual(d.countries, [...EU_COUNTRIES])
  assert.equal(d.countries.length, 27)
  assert.deepEqual(d.codCountries, { PL: ["PLN"] })
  assert.equal(d.labelPage, "A4")
  assert.equal(d.weightUnit, "g")
  assert.equal(d.defaultBox, null)
  assert.equal(d.documentRetentionDays, 90)
  assert.equal(d.trackingMode, "waybill")
  assert.deepEqual(d.codPaymentProviders, ["pp_system_default"])
  assert.equal(d.internationalReturns, false)
  assert.equal(d.autoCreate, false)
  assert.deepEqual(d.statusMap, {})
  assert.deepEqual(d.senders, {})
  assert.deepEqual(d.problems, [])
})

test("environment strings: booleans, numbers, comma lists and JSON objects", () => {
  const o = resolveOptions({
    internationalReturns: "yes",
    autoCreate: "0",
    documentRetentionDays: "30",
    countries: "pl, de ,CZ,pl",
    codCountries: '{"PL":"PLN","cz":["czk"," EUR "]}',
    codPaymentProviders: "pp_system_default, pp_cod",
    labelPage: "lbl_printer",
    trackingMode: "QUEUE",
    weightUnit: "KG",
    defaultBox: '{"weightKg":"2,5","lengthCm":40,"widthCm":"30","heightCm":20}',
    statusMap: '{"230402":"returned","990001":"IN_POINT"}',
    sender: '{"company":"Koda Supply","street":"ul. Przykładowa 5","city":"Warszawa","postalCode":"00-950","phone":"000000001"}',
    senders: '{"sloc_01":{"company":"Magazyn 2","street":"ul. Druga 1","city":"Kraków","postalCode":"30001","phone":"000000003"}}',
  })
  assert.deepEqual(o.problems, [])
  assert.equal(o.internationalReturns, true)
  assert.equal(o.autoCreate, false)
  assert.equal(o.documentRetentionDays, 30)
  assert.deepEqual(o.countries, ["PL", "DE", "CZ"])
  assert.deepEqual(o.codCountries, { PL: ["PLN"], CZ: ["CZK", "EUR"] })
  assert.deepEqual(o.codPaymentProviders, ["pp_system_default", "pp_cod"])
  assert.equal(o.labelPage, "LBL_PRINTER")
  assert.equal(o.trackingMode, "queue")
  assert.equal(o.weightUnit, "kg")
  assert.deepEqual(o.defaultBox, { weightKg: 2.5, lengthCm: 40, widthCm: 30, heightCm: 20 })
  assert.deepEqual(o.statusMap, { "230402": "returned", "990001": "in_point" })
  assert.equal(o.sender.company, "Koda Supply")
  assert.equal(o.sender.postalCode, "00950")
  assert.equal(o.senders.sloc_01?.city, "Kraków")
  assert.equal(o.orderer.name, "Koda Supply", "the orderer falls back to the sender")
})

test("broken values are ignored and listed, never thrown", () => {
  const o = resolveOptions({
    countries: "PL,US,XYZ",
    codCountries: { PL: ["PLN", "USD"], DE: "EUR", us: "USD", GB: "GBP" },
    labelPage: "A6",
    trackingMode: "push",
    weightUnit: "lb",
    defaultBox: { weightKg: 900 },
    statusMap: { "230402": "lost", "bad code!": "delivered" },
    documentRetentionDays: "forever",
    sender: "{not json",
    senders: { sloc_01: "Magazyn" },
  })
  assert.deepEqual(o.countries, ["PL"])
  assert.deepEqual(o.codCountries, { PL: ["PLN"] })
  assert.equal(o.labelPage, "A4")
  assert.equal(o.trackingMode, "waybill")
  assert.equal(o.weightUnit, "g")
  assert.equal(o.defaultBox, null)
  assert.deepEqual(o.statusMap, {})
  assert.equal(o.documentRetentionDays, 90)
  assert.equal(o.sender.company, "")
  assert.deepEqual(o.senders, {})
  assert.deepEqual(
    [...o.problems].sort(),
    [
      "codCountries.DE (not in countries)",
      "codCountries.GB (not in countries)",
      "codCountries.PL.USD (PLN, EUR, RON or CZK)",
      "codCountries.US (not in countries)",
      "countries.US (outside the EU, not supported)",
      "countries.XYZ (ISO alpha-2 code)",
      "defaultBox.weightKg (0.01 to 700)",
      "documentRetentionDays (a whole number from 1 to 3650)",
      "labelPage (A4 or LBL_PRINTER)",
      "statusMap.230402 (preparing, ready, in_transit, in_point, delivered, problem, returned, canceled)",
      "statusMap.bad code! (an event code)",
      "sender (JSON object)",
      "senders.sloc_01 (a sender object)",
      "trackingMode (waybill or queue)",
      "weightUnit (g or kg)",
    ].sort(),
  )
  const noCountry = resolveOptions({ countries: "US" })
  assert.deepEqual(noCountry.countries, [...EU_COUNTRIES], "nothing usable left: the EU, never an empty list")
  assert.ok(noCountry.problems.includes("countries (no usable country, the EU is used)"))
  assert.deepEqual(resolveOptions({ codCountries: {} }).codCountries, {}, "an empty map turns cash on delivery off")
  assert.deepEqual(resolveOptions({ countries: "DE" }).codCountries, {}, "the default PL entry needs PL among the countries")
  assert.equal(resolveOptions({ documentRetentionDays: 99999 }).documentRetentionDays, 3650)
  assert.deepEqual(resolveOptions({ defaultBox: { weightKg: 1, lengthCm: 500 } }).defaultBox, { weightKg: 1, lengthCm: null, widthCm: null, heightCm: null })
})

test("lists as JSON arrays in a string; a broken one, an unreadable number or one out of range is a problem", () => {
  const o = resolveOptions({ countries: '["pl", "DE"]', codCountries: { PL: '["PLN"]' }, codPaymentProviders: '["pp_cod", "pp_system_default", "pp_cod"]' })
  assert.deepEqual(o.problems, [])
  assert.deepEqual(o.countries, ["PL", "DE"])
  assert.deepEqual(o.codCountries, { PL: ["PLN"] })
  assert.deepEqual(o.codPaymentProviders, ["pp_cod", "pp_system_default"], "a JSON array is never one literal provider id")
  assert.deepEqual(resolveOptions({ codPaymentProviders: "[]" }).codPaymentProviders, [], "an empty JSON array turns it off, like an empty array")
  const broken = resolveOptions({ countries: '["PL"', codPaymentProviders: "[pp_cod]" })
  assert.deepEqual(broken.countries, [...EU_COUNTRIES], "a broken list is not read as one odd country")
  assert.deepEqual(broken.codPaymentProviders, ["pp_system_default"], "a broken list is never a provider id")
  assert.deepEqual([...broken.problems].sort(), ["codPaymentProviders (JSON array)", "countries (JSON array)"])
  for (const [v, days] of [["abc", 90], [Number.NaN, 90], [true, 90], ["0", 1], [-4, 1], [99999, 3650]] as const) {
    const r = resolveOptions({ documentRetentionDays: v as never })
    assert.equal(r.documentRetentionDays, days, String(v))
    assert.deepEqual(r.problems, ["documentRetentionDays (a whole number from 1 to 3650)"], String(v))
  }
  assert.deepEqual(resolveOptions({ documentRetentionDays: " 45 " }).problems, [])
  assert.equal(resolveOptions({ documentRetentionDays: " 45 " }).documentRetentionDays, 45)
  assert.deepEqual(resolveOptions({ documentRetentionDays: "" }).problems, [], "unset is no problem")
  for (const v of ["12.5", 12.5]) {
    const r = resolveOptions({ documentRetentionDays: v as never })
    assert.equal(r.documentRetentionDays, 12, `${String(v)}: rounded down`)
    assert.deepEqual(r.problems, ["documentRetentionDays (a whole number from 1 to 3650)"], `${String(v)}: a fraction is no whole number`)
  }
})

test("settings: per mode keys; a saved label page wins over the option", () => {
  assert.equal(settingsKey("live"), "live:settings")
  assert.equal(DEMO_SEEDED_KEY, "demo:seeded")
  const o = resolveOptions({ labelPage: "LBL_PRINTER" })
  assert.deepEqual(effectiveSettings(o, null), { labelPage: "LBL_PRINTER", source: { labelPage: "option" } })
  assert.deepEqual(effectiveSettings(o, readStoredSettings({ labelPage: "a4", other: 1 })), { labelPage: "A4", source: { labelPage: "admin" } })
  assert.deepEqual(readStoredSettings("x"), {})
  assert.deepEqual(validateSettingsInput({ labelPage: "A6" }), { ok: false, errors: ["labelPage"] })
  assert.deepEqual(validateSettingsInput(null), { ok: false, errors: ["body"] })
  assert.deepEqual(validateSettingsInput({ labelPage: "A4" }), { ok: true, value: { labelPage: "A4" } })
})
