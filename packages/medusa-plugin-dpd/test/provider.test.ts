/**
 * The fulfillment provider: the five frozen option ids, the checks at
 * checkout (each option, cash on delivery per country and currency, Pickup
 * points), what a fulfillment records (never a request to DPD), the refused
 * cancel after the handover, the return that never throws.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { checkMethodData, fulfillmentOptions, pickDpdMethod, readFulfillmentData, specOf, validateMethodData, type CheckoutContext, type CheckoutRules } from "../src/modules/dpd/lib/option-data.ts"
import { resolveOptions } from "../src/modules/dpd/lib/options.ts"
import DpdFulfillmentProvider from "../src/providers/dpd/service.ts"
import { SANDBOX } from "./helpers.ts"

/* Stage 1 talks to nobody: any request fails the test. */
const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in the provider")
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "the provider never calls DPD")
})

const silent = { info: () => {}, warn: () => {}, error: () => {} }
const provider = (options: Record<string, unknown> = SANDBOX) => new DpdFulfillmentProvider({ logger: silent }, options)

const ADDRESS = { address_1: "ul. Przykładowa 5/2", city: "Warszawa", postal_code: "00-950", country_code: "pl", phone: "+48 000 000 002" }
const CART: CheckoutContext = { currency_code: "pln", email: "anna@example.com", shipping_address: ADDRESS }
const DE_CART: CheckoutContext = { currency_code: "eur", email: "anna@example.com", shipping_address: { ...ADDRESS, postal_code: "10115", city: "Berlin", country_code: "de" } }

/** The code of a check, "ok" when it passes. */
function code(optionId: string, data: Record<string, unknown> = {}, context: CheckoutContext | null = CART, rules?: CheckoutRules): string {
  const r = validateMethodData({ id: optionId }, data, context, rules)
  return r.ok ? "ok" : r.error.code
}

test("five options with the frozen ids; only the return option is flagged is_return", async () => {
  const options = await provider().getFulfillmentOptions()
  assert.deepEqual(
    options.map((o) => [o.id, o.kind, o.cod, o.is_return]),
    [
      ["dpd-courier", "courier", false, false],
      ["dpd-courier-cod", "courier", true, false],
      ["dpd-pickup", "pickup", false, false],
      ["dpd-pickup-cod", "pickup", true, false],
      ["dpd-return", "return", false, true],
    ],
  )
  assert.ok(options.every((o) => typeof o.name === "string" && o.name.startsWith("DPD")))
  assert.equal(fulfillmentOptions().length, 5)
  assert.equal((DpdFulfillmentProvider as unknown as { identifier: string }).identifier, "dpd")
})

test("the option of a shipping option is its data.id; anything else is not ours", async () => {
  assert.equal(specOf({ id: "dpd-pickup-cod" })?.kind, "pickup")
  assert.equal(specOf({ id: "dpd-return" })?.kind, "return")
  assert.equal(specOf({ id: "inpost-kurier" }), null)
  assert.equal(specOf({ kind: "courier" }), null, "no guessing from other fields")
  assert.equal(specOf(null), null)
  const p = provider()
  assert.equal(await p.validateOption({ id: "dpd-courier", name: "x" }), true)
  assert.equal(await p.validateOption({ id: "dhl" }), false)
  assert.equal(await p.canCalculate(), false)
  assert.deepEqual(await p.calculatePrice(), { calculated_amount: 0, is_calculated_price_tax_inclusive: true })
})

test("courier: a complete address in a country of the store", () => {
  assert.equal(code("dpd-courier"), "ok")
  assert.equal(code("dpd-courier", {}, DE_CART), "ok", "the EU by default")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: { ...ADDRESS, country_code: "us" } }), "country_unsupported")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: { ...ADDRESS, country_code: "cz" } }, { countries: ["PL"], codCountries: {} }), "country_unsupported", "only the countries of the options")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: { ...ADDRESS, address_1: "" } }), "address_incomplete")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: { ...ADDRESS, city: " " } }), "address_incomplete")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: { ...ADDRESS, postal_code: "123" } }), "address_incomplete", "a Polish code has five digits")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: { ...ADDRESS, country_code: "" } }), "address_incomplete")
  assert.equal(code("dpd-courier", {}, { ...CART, shipping_address: null }), "ok", "no address yet: the plan checks it later")
  assert.equal(code("dpd-courier", {}, null), "ok")
  const ok = validateMethodData({ id: "dpd-courier" }, { pudo_id: "PL14509" }, CART)
  assert.deepEqual(ok.ok && ok.data, { dpd_option: "dpd-courier", dpd_kind: "courier", dpd_cod: false, dpd_pudo_id: null, dpd_country: "PL" })
})

test("Pickup: a point id of the right shape and a phone or an e-mail of the recipient", () => {
  assert.equal(code("dpd-pickup"), "pudo_missing")
  assert.equal(code("dpd-pickup", { pudo_id: "" }), "pudo_missing")
  assert.equal(code("dpd-pickup", { pudo_id: "DROP TABLE" }), "pudo_invalid")
  assert.equal(code("dpd-pickup", { pudo_id: "14509" }), "pudo_invalid")
  assert.equal(code("dpd-pickup", { pudo_id: "PL" }), "pudo_invalid")
  const ok = validateMethodData({ id: "dpd-pickup" }, { pudo_id: " pl 14509 " }, CART)
  assert.deepEqual(ok.ok && ok.data, { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL14509", dpd_country: "PL" })
  for (const id of ["PL14509", "PL11726", "DE0123456", "CZ12345"]) assert.equal(code("dpd-pickup", { pudo_id: id }), "ok", id)
  assert.equal(code("dpd-pickup", { pudo_id: "US12345" }), "country_unsupported", "the point's country is the prefix")
  const noContact = { currency_code: "pln", email: null, shipping_address: { ...ADDRESS, phone: "" } }
  assert.equal(code("dpd-pickup", { pudo_id: "PL14509" }, noContact), "contact_missing")
  assert.equal(code("dpd-pickup", { pudo_id: "PL14509" }, { ...noContact, email: "anna@example.com" }), "ok", "an e-mail is enough")
  assert.equal(code("dpd-pickup", { pudo_id: "PL14509" }, { ...noContact, customer: { email: "anna@example.com" } }), "ok")
  assert.equal(code("dpd-pickup", { pudo_id: "PL14509" }, { currency_code: "pln", shipping_address: ADDRESS }), "ok", "a phone is enough")
  assert.equal(code("dpd-pickup", { pudo_id: "PL14509" }, null), "ok", "no cart context: nothing to check against")
  assert.equal(code("dpd-pickup", { dpd_pudo_id: "PL14509" }), "ok", "data validated once before keeps working")
})

test("cash on delivery: the currency codCountries allows for the destination, at a Pickup point only in Poland", () => {
  const rules: CheckoutRules = { countries: ["PL", "DE", "CZ"], codCountries: { PL: ["PLN"], CZ: ["CZK", "EUR"] } }
  assert.equal(code("dpd-courier-cod", {}, CART, rules), "ok")
  assert.equal(code("dpd-courier-cod", {}, { ...CART, currency_code: "eur" }, rules), "cod_currency_unsupported")
  assert.equal(code("dpd-courier-cod", {}, DE_CART, rules), "cod_country_unsupported", "Germany is a country of the store, without cash on delivery")
  const cz = { ...CART, shipping_address: { ...ADDRESS, postal_code: "11000", city: "Praha", country_code: "cz" } }
  assert.equal(code("dpd-courier-cod", {}, { ...cz, currency_code: "czk" }, rules), "ok")
  assert.equal(code("dpd-courier-cod", {}, { ...cz, currency_code: "eur" }, rules), "ok")
  assert.equal(code("dpd-courier-cod", {}, { ...cz, currency_code: "pln" }, rules), "cod_currency_unsupported")
  assert.equal(code("dpd-courier-cod", {}, { currency_code: "ron" }, rules), "cod_currency_unsupported", "no address: the currency must work somewhere")
  assert.equal(code("dpd-courier-cod", {}, { currency_code: "czk" }, rules), "ok")
  assert.equal(code("dpd-courier-cod", {}, CART, { countries: ["PL"], codCountries: {} }), "cod_country_unsupported", "codCountries {} turns it off")
  assert.equal(code("dpd-courier-cod", {}, DE_CART), "cod_country_unsupported", "default: Poland only")
  assert.equal(code("dpd-pickup-cod", { pudo_id: "PL14509" }, CART, rules), "ok")
  assert.equal(code("dpd-pickup-cod", { pudo_id: "CZ12345" }, { ...CART, currency_code: "czk" }, rules), "cod_pickup_abroad", "COD at a point abroad does not work")
  assert.equal(code("dpd-pickup-cod", { pudo_id: "DE0123456" }, DE_CART), "cod_pickup_abroad")
  assert.equal(code("dpd-pickup-cod", { pudo_id: "PL14509" }, { ...CART, currency_code: "eur" }), "cod_currency_unsupported")
  const ok = validateMethodData({ id: "dpd-pickup-cod" }, { pudo_id: "PL14509" }, CART)
  assert.equal(ok.ok && ok.data.dpd_cod, true)
})

test("the return option: refused at checkout, accepted for a return, claim or exchange", () => {
  assert.equal(code("dpd-return"), "return_not_selectable")
  assert.equal(code("dpd-return", {}, null), "return_not_selectable")
  assert.equal(code("dpd-return", {}, { ...CART, return_id: "return_01" }), "ok")
  assert.equal(code("dpd-return", {}, { claim_id: "claim_01" }), "ok")
  assert.equal(code("dpd-return", {}, { exchange_id: "exch_01" }), "ok")
  assert.equal(code("dpd-unknown"), "option_unknown")
})

test("validateFulfillmentData throws a readable error and uses the store rules of the options", async () => {
  await assert.rejects(provider().validateFulfillmentData({ id: "dpd-pickup" }, {}, { ...CART }), /Choose a DPD Pickup point/)
  await assert.rejects(provider().validateFulfillmentData({ id: "dpd-return" }, {}, { ...CART }), /for returns only/)
  const czCart = { ...CART, currency_code: "czk", shipping_address: { ...ADDRESS, postal_code: "11000", country_code: "cz" } }
  await assert.rejects(provider().validateFulfillmentData({ id: "dpd-courier-cod" }, {}, czCart), /not available for this country/)
  const cz = provider({ ...SANDBOX, codCountries: { PL: "PLN", CZ: "CZK" } })
  const data = await cz.validateFulfillmentData({ id: "dpd-courier-cod" }, {}, czCart)
  assert.deepEqual(data, { dpd_option: "dpd-courier-cod", dpd_kind: "courier", dpd_cod: true, dpd_pudo_id: null, dpd_country: "CZ" })
  const narrow = provider({ ...SANDBOX, countries: "PL" })
  await assert.rejects(narrow.validateFulfillmentData({ id: "dpd-courier" }, {}, czCart), /does not ship with DPD to this country/)
})

test("a fulfillment records the choice and sends nothing; data without a DPD option is kept as it came", async () => {
  const p = provider()
  const res = await p.createFulfillment({ dpd_option: "dpd-pickup", dpd_pudo_id: "pl14509", dpd_country: "PL", other: 1 }, [], undefined, {})
  assert.deepEqual(res.labels, [])
  assert.equal(res.data.dpd_option, "dpd-pickup")
  assert.equal(res.data.dpd_pudo_id, "PL14509")
  assert.equal(res.data.other, 1)
  assert.ok(typeof res.data.dpd_recorded_at === "string")
  assert.deepEqual(readFulfillmentData(res.data), { spec: specOf({ id: "dpd-pickup" }), pudoId: "PL14509", country: "PL" })
  const bare = await p.createFulfillment({ dpd_option: "dpd-courier-cod" }, [], undefined, {})
  assert.equal(bare.data.dpd_cod, true, "missing extras never throw")
  assert.equal(bare.data.dpd_country, null)
  const foreign = await p.createFulfillment({ machine_id: "KSP01M" }, [], undefined, {})
  assert.deepEqual(foreign.data, { machine_id: "KSP01M" })
  assert.equal(readFulfillmentData(null), null)
  assert.equal(readFulfillmentData({ dpd_option: "dpd-courier", dpd_country: "Poland" })?.country, null)
})

test("data in the shape of the shipping option (a claim, an exchange, an order edit, a draft order) is read and recorded like checkout data", async () => {
  /* What Medusa copies into such a shipping method: the option data, never checked by validateFulfillmentData. */
  const [, courierCod, pickup] = fulfillmentOptions()
  assert.deepEqual(readFulfillmentData(courierCod), { spec: specOf({ id: "dpd-courier-cod" }), pudoId: null, country: null })
  assert.equal(readFulfillmentData(pickup)?.spec.kind, "pickup")
  assert.equal(readFulfillmentData(pickup)?.pudoId, null, "the option names no point")
  assert.equal(readFulfillmentData({ id: "inpost-kurier", kind: "courier" }), null)
  assert.equal(readFulfillmentData({ dpd_option: "dpd-pickup", id: "dpd-courier" })?.spec.id, "dpd-pickup", "checkout data wins")
  const res = await provider().createFulfillment({ ...courierCod }, [], undefined, {})
  assert.equal(res.data.dpd_option, "dpd-courier-cod")
  assert.equal(res.data.dpd_kind, "courier")
  assert.equal(res.data.dpd_cod, true)
  assert.equal(res.data.dpd_pudo_id, null)
  assert.ok(typeof res.data.dpd_recorded_at === "string")
  assert.equal(readFulfillmentData(res.data)?.spec.id, "dpd-courier-cod")
})

test("the DPD method of an order: the one of the fulfillment's shipping option, else the one the checkout validated, else the first", () => {
  const checkout = { id: "sm_1", shipping_option_id: "so_pickup", data: { dpd_option: "dpd-pickup", dpd_pudo_id: "PL14509", dpd_country: "PL" } }
  const claim = { id: "sm_2", shipping_option_id: "so_courier", data: { id: "dpd-courier", kind: "courier", cod: false } }
  const other = { id: "sm_0", shipping_option_id: "so_manual", data: { id: "manual" } }
  const methods = [other, claim, checkout]
  assert.equal(pickDpdMethod(methods, "so_courier")?.method.id, "sm_2")
  assert.equal(pickDpdMethod(methods, "so_pickup")?.read.pudoId, "PL14509")
  assert.equal(pickDpdMethod(methods, null)?.method.id, "sm_1", "no option: the method the checkout validated")
  assert.equal(pickDpdMethod(methods, "so_gone")?.method.id, "sm_1", "an option no method has: the same")
  assert.equal(pickDpdMethod([other, claim])?.method.id, "sm_2", "only option-shaped methods: the first DPD one")
  assert.equal(pickDpdMethod(methods, "so_manual")?.method.id, "sm_1", "a method that is not DPD's is never picked")
  assert.equal(pickDpdMethod([other]), null)
  assert.equal(pickDpdMethod(null), null)
  const again = { id: "sm_3", shipping_option_id: "so_pickup", data: { id: "dpd-pickup", kind: "pickup", cod: false } }
  assert.equal(pickDpdMethod([again, checkout], "so_pickup")?.method.id, "sm_1", "several methods of the option: the one the checkout validated")
  assert.equal(pickDpdMethod([again, claim], "so_pickup")?.method.id, "sm_3", "none of them validated: the first of the option")
})

test("checkMethodData lists every check that fails, in the order of the checkout; validateMethodData gives the first", () => {
  const spec = specOf({ id: "dpd-courier-cod" })
  const pickupCod = specOf({ id: "dpd-pickup-cod" })
  assert.ok(spec && pickupCod)
  const rules: CheckoutRules = { countries: ["PL", "DE"], codCountries: { PL: ["PLN"] } }
  const codes = (s: NonNullable<ReturnType<typeof specOf>>, data: Record<string, unknown>, context: CheckoutContext) => checkMethodData(s, data, context, rules).errors.map((e) => e.code)
  assert.deepEqual(codes(spec, {}, { currency_code: "eur", shipping_address: { ...ADDRESS, address_1: "" } }), ["cod_currency_unsupported", "address_incomplete"])
  assert.deepEqual(codes(spec, {}, { currency_code: "pln", shipping_address: { ...ADDRESS, country_code: "fr" } }), ["country_unsupported"], "no cash on delivery check for a country the store does not ship to")
  assert.deepEqual(codes(spec, {}, { currency_code: "pln", shipping_address: {} }), ["address_incomplete"])
  assert.deepEqual(codes(pickupCod, {}, { currency_code: "pln", shipping_address: {} }), ["pudo_missing", "contact_missing"], "no point: no country, no abroad check")
  assert.deepEqual(codes(pickupCod, { pudo_id: "DE0123456" }, CART), ["cod_pickup_abroad"])
  const first = validateMethodData({ id: "dpd-courier-cod" }, {}, { currency_code: "eur", shipping_address: { ...ADDRESS, address_1: "" } }, rules)
  assert.equal(!first.ok && first.error.code, "cod_currency_unsupported")
  assert.deepEqual(checkMethodData(spec, {}, CART, rules), { errors: [], pudoId: null, country: "PL" })
})

test("cancel: nothing to undo before the handover, refused after it", async () => {
  const p = provider()
  assert.deepEqual(await p.cancelFulfillment({ dpd_option: "dpd-courier" }), {})
  assert.deepEqual(await p.cancelFulfillment({ dpd_option: "dpd-courier", dpd_handed_over_at: null }), {})
  await assert.rejects(
    () => p.cancelFulfillment({ dpd_option: "dpd-courier", dpd_handed_over_at: "2026-11-02T14:00:00.000Z" }),
    (err: Error & { type?: string }) => err.type === "not_allowed" && /handed to the courier/.test(err.message),
  )
})

test("a return writes nothing and never throws; stage 1 has no documents", async () => {
  const p = provider({})
  const res = await p.createReturnFulfillment({ id: "ful_ret_01", data: { note: "x" } })
  assert.deepEqual(res.labels, [])
  assert.equal(res.data.dpd_option, "dpd-return")
  assert.equal(res.data.dpd_kind, "return")
  assert.equal(res.data.note, "x")
  assert.equal((await p.createReturnFulfillment({})).data.dpd_option, "dpd-return")
  assert.deepEqual(await p.getFulfillmentDocuments({ dpd_option: "dpd-courier" }), [])
})

test("the provider is lenient with its options: broken values never stop it", async () => {
  DpdFulfillmentProvider.validateOptions({ mode: "nonsense", countries: 7 })
  const p = new DpdFulfillmentProvider({}, { mode: "nonsense", countries: "XX", codCountries: "{bad" })
  assert.equal((await p.getFulfillmentOptions()).length, 5)
  assert.equal(resolveOptions({ mode: "nonsense" }).mode, "sandbox")
})
