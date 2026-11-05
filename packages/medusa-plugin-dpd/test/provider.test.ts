/**
 * The fulfillment provider: the five frozen option ids, the checks at
 * checkout (each option, cash on delivery per country and currency, Pickup
 * points), what a fulfillment records (never a request to DPD), the refused
 * cancel after the handover, the return that never throws. Pickup points are
 * checked in the catalog of the mode (fakes; never MyPudo) and fail open.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { catalogPoint } from "../src/modules/dpd/lib/mypudo.ts"
import { checkMethodData, checkoutError, fulfillmentOptions, pickDpdMethod, readFulfillmentData, specOf, validateMethodData, type CheckoutContext, type CheckoutErrorCode, type CheckoutRules } from "../src/modules/dpd/lib/option-data.ts"
import { resolveOptions } from "../src/modules/dpd/lib/options.ts"
import { catalogSource, SANDBOX_POINTS, type PointsSource } from "../src/modules/dpd/lib/points.ts"
import DpdFulfillmentProvider from "../src/providers/dpd/service.ts"
import { createDispatch, cancelDispatch, planDispatch, printProtocol } from "../src/workflows/dpd/dispatch.ts"
import { FakeDpdServices } from "./fake-dpdservices.ts"
import { arm, countingPoints, insertLabeled, labeledOrder, SANDBOX, setup } from "./helpers.ts"

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

/* Stage 3: the point itself at checkout (spec 7.2). */

const SANDBOX_PLUS = [
  ...SANDBOX_POINTS,
  catalogPoint({ id: "PL0SBX04", name: "Punkt testowy bez pobrania", type: "100", line1: "Testowa 4", zip: "02-495", city: "Warszawa", active: true, services: ["100"] }),
  catalogPoint({ id: "DE0SBX01", name: "Testpunkt", type: "100", line1: "Teststr. 1", zip: "10115", city: "Berlin", country: "DE", active: true, services: ["100"] }),
]

function withPoints(points: PointsSource, options: Record<string, unknown> = SANDBOX) {
  const logs: string[] = []
  const logger = { info: (m: string) => void logs.push(`info ${m}`), warn: (m: string) => void logs.push(`warn ${m}`), error: (m: string) => void logs.push(`error ${m}`) }
  return { p: new DpdFulfillmentProvider({ logger, dpdPointsSource: points }, options), logs }
}

async function refusedAs(work: Promise<unknown>, code: CheckoutErrorCode): Promise<void> {
  await assert.rejects(work, (err: Error & { type?: string }) => err.type === "invalid_data" && err.message === checkoutError(code).message)
}

test("Pickup at checkout: a point of the catalog is stored as a snapshot, the refused ones are refused with their own code", async () => {
  const points = countingPoints(catalogSource("sandbox", SANDBOX_PLUS))
  const { p } = withPoints(points)
  const data = await p.validateFulfillmentData({ id: "dpd-pickup-cod" }, { pudo_id: "pl14509", dpd_pudo: { name: "forged" } }, CART)
  assert.deepEqual(data, {
    dpd_option: "dpd-pickup-cod",
    dpd_kind: "pickup",
    dpd_cod: true,
    dpd_pudo_id: "PL14509",
    dpd_country: "PL",
    dpd_pudo: { name: "DPD Pickup, Oddział Miejski", line1: "Skoroszewska 11", zip: "02-495", city: "Warszawa", country: "PL", type: "300", isLocker: false },
  }, "the snapshot of the catalog, never the one the client sent; no hours, no services")
  assert.equal(points.reads, 1, "a fresh read per check")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL0SBX01" }, CART), "pudo_inactive")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL0SBX02" }, CART), "pudo_no_delivery")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup-cod" }, { pudo_id: "PL0SBX04" }, CART), "pudo_no_cod")
  assert.equal((await p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL0SBX04" }, CART)).dpd_pudo_id, "PL0SBX04", "without COD the point is fine")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL0SBX99" }, CART), "pudo_not_found")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "DE0SBX01" }, DE_CART), "pickup_abroad_later")
  const reads = points.reads
  await p.validateFulfillmentData({ id: "dpd-courier" }, {}, CART)
  await assert.rejects(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "14509" }, CART))
  assert.equal(points.reads, reads, "a courier and a malformed id never ask the source")
})

test("Pickup at checkout fails open: a source that is down, slow or not configured accepts the point unchecked, with one warning and no secret", async () => {
  const points = countingPoints(catalogSource("live", SANDBOX_POINTS))
  const { p, logs } = withPoints(points)
  for (const fail of ["timeout", "network", "not_configured"] as const) {
    points.fail.details = fail
    const data = await p.validateFulfillmentData({ id: "dpd-pickup-cod" }, { pudo_id: "PL0SBX01" }, CART)
    assert.equal(data.dpd_pudo_id, "PL0SBX01", fail)
    assert.equal("dpd_pudo" in data, false, "no snapshot without a check")
  }
  points.fail.details = undefined
  points.fail.throws = true
  assert.equal((await p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL14509" }, CART)).dpd_pudo_id, "PL14509")
  const warns = logs.filter((l) => l.startsWith("warn "))
  assert.equal(warns.length, 4, "one warning per unchecked point")
  assert.match(warns[0] ?? "", /PL0SBX01 \(timeout\)/)
  assert.ok(warns.every((l) => !/key=|https?:/.test(l)))
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "DE0123456" }, DE_CART), "pickup_abroad_later")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup-cod" }, { pudo_id: "DE0123456" }, DE_CART), "cod_pickup_abroad")

  /* The source of the mode itself: live without MyPudo credentials is unchecked, without a request. */
  const live = new DpdFulfillmentProvider({ logger: silent }, { ...SANDBOX, mode: "live" })
  assert.equal((await live.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL14509" }, CART)).dpd_pudo_id, "PL14509")
})

test("Pickup at checkout in demo: an id outside the sample catalog is accepted without a snapshot and without a warning; a refused demo point is refused", async () => {
  const p = provider({ ...SANDBOX, demo: true })
  const data = await p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL14509" }, CART)
  assert.equal(data.dpd_pudo_id, "PL14509")
  assert.equal("dpd_pudo" in data, false)
  const logs: string[] = []
  const quiet = new DpdFulfillmentProvider({ logger: { info: (m: string) => void logs.push(`info ${m}`), warn: (m: string) => void logs.push(`warn ${m}`), error: () => {} } }, { ...SANDBOX, demo: true })
  await quiet.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL14509" }, CART)
  assert.equal(logs.filter((l) => l.startsWith("warn ")).length, 0)
  assert.equal((await p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL9DEMO01" }, CART)).dpd_pudo !== undefined, true)
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL9DEMO06" }, CART), "pudo_inactive")
  await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "PL9DEMO07" }, CART), "pudo_no_delivery")
  /* Demo waives the existence of a point, never the rule of stage 3: an id abroad is refused by its prefix (E21). */
  for (const cart of [CART, DE_CART]) await refusedAs(p.validateFulfillmentData({ id: "dpd-pickup" }, { pudo_id: "DE1234567" }, cart), "pickup_abroad_later")
})

/* Stage 4: the marker of the handover, written by the flow (DS6). */

async function handedOver() {
  const fake = new FakeDpdServices()
  const s = setup({ ...SANDBOX, mode: "live", shipmentWriter: true }, [], { fake })
  arm(s, "shipment")
  const row = insertLabeled(s, labeledOrder(1))
  const { plan } = await planDispatch(s.container, [String(row.id)])
  const view = await createDispatch(s.container, { shipmentIds: [String(row.id)], planHash: plan.hash }, { actor: "user_01ADMIN" })
  const printed = await printProtocol(s.container, view.dispatch.id, { actor: "user_01ADMIN" })
  assert.equal(printed.dispatch.state, "printed")
  const fulfillment = s.fulfillments.get(String(row.fulfillment_id))
  assert.ok(fulfillment)
  return { s, id: view.dispatch.id, fulfillment }
}

test("cancelFulfillment refuses after a marker written by the flow", async () => {
  const { fulfillment, id } = await handedOver()
  assert.equal(fulfillment.data.dpd_dispatch_id, id)
  await assert.rejects(
    () => provider().cancelFulfillment(fulfillment.data),
    (err: Error & { type?: string }) => err.type === "not_allowed",
  )
})

test("cancelFulfillment passes after the marker is cleared", async () => {
  const { s, id, fulfillment } = await handedOver()
  await cancelDispatch(s.container, id, { actor: "user_01ADMIN" })
  assert.equal(fulfillment.data.dpd_handed_over_at, null)
  assert.equal(fulfillment.data.dpd_dispatch_id, null)
  assert.deepEqual(await provider().cancelFulfillment(fulfillment.data), {})
})

test("validateFulfillmentData drops dpd_handed_over_at and dpd_dispatch_id sent by the store", async () => {
  const data = await provider().validateFulfillmentData({ id: "dpd-courier" }, { dpd_handed_over_at: "2026-11-02T14:00:00.000Z", dpd_dispatch_id: "dpddsp_FORGED" }, { ...CART })
  assert.equal("dpd_handed_over_at" in data, false)
  assert.equal("dpd_dispatch_id" in data, false)
})
