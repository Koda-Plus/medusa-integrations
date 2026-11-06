/**
 * The fulfillment provider: the four options and their ids (a contract with
 * existing shipping options), the checks at checkout, the locker check that
 * fails open, and what a fulfillment records (never a request to ShipX).
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { fulfillmentOptions, readFulfillmentData, specOf, validateMethodData } from "../src/modules/inpost/lib/option-data.ts"
import InpostFulfillmentProvider from "../src/providers/inpost/service.ts"
import { FakeShipx, LIVE } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const silent = { info: () => {}, warn: () => {}, error: () => {} }
const provider = (options: Record<string, unknown> = {}) => new InpostFulfillmentProvider({ logger: silent }, options)

const LOCKER = { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" }
const ADDRESS = { address_1: "ul. Przykładowa 5/2", city: "Warszawa", postal_code: "00-950", country_code: "pl" }

test("four options with the ids existing shipping options use, and the legacy type and cod fields; then the return option", async () => {
  const all = await provider().getFulfillmentOptions()
  const options = all.filter((o) => !o.is_return)
  assert.deepEqual(
    options.map((o) => [o.id, o.kind, o.cod, o.service, o.type]),
    [
      ["inpost-paczkomat", "locker", false, "inpost_locker_standard", "paczkomat"],
      ["inpost-paczkomat-cod", "locker", true, "inpost_locker_standard", "paczkomat"],
      ["inpost-kurier", "courier", false, "inpost_courier_standard", "kurier"],
      ["inpost-kurier-cod", "courier", true, "inpost_courier_standard", "kurier"],
    ],
  )
  assert.equal(PROVIDER(), "inpost")
  assert.equal(fulfillmentOptions().length, 4)
  /* The return option comes last, marked is_return, so Medusa offers it for return shipping options. */
  assert.deepEqual(all.map((o) => o.id), ["inpost-paczkomat", "inpost-paczkomat-cod", "inpost-kurier", "inpost-kurier-cod", "inpost-zwrot"])
  assert.equal(all[4].is_return, true)
  assert.equal(await provider().validateOption({ id: "inpost-zwrot" }), true)
  assert.equal(await provider().validateOption({ id: "dpd-zwrot" }), false)
})

function PROVIDER(): string {
  return (InpostFulfillmentProvider as unknown as { identifier: string }).identifier
}

test("the option of a shipping option: by data.id, else by the type and cod of older data, never a foreign id", async () => {
  assert.equal(specOf({ id: "inpost-kurier-cod", type: "kurier" })?.id, "inpost-kurier-cod")
  assert.equal(specOf({ id: "inpost-paczkomat" })?.kind, "locker")
  assert.equal(specOf({ type: "paczkomat", cod: true })?.id, "inpost-paczkomat-cod")
  assert.equal(specOf({ type: "kurier" })?.id, "inpost-kurier")
  assert.equal(specOf({ id: "manual-fulfillment", type: "kurier" }), null)
  assert.equal(specOf({}), null)
  assert.equal(await provider().validateOption({ id: "inpost-paczkomat", name: "x" }), true)
  assert.equal(await provider().validateOption({ id: "dhl" }), false)
  assert.equal(await provider().canCalculate(), false)
})

test("checkout: a locker option needs a locker code of the right shape; the answer keeps the legacy fields", () => {
  assert.deepEqual(validateMethodData({ id: "inpost-paczkomat" }, {}, null), { ok: false, error: { code: "locker_missing", message: "Choose an InPost parcel locker for this delivery." } })
  const bad = validateMethodData({ id: "inpost-paczkomat" }, { machine_id: "DROP TABLE" }, null)
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.error.code, "locker_invalid")
  const ok = validateMethodData({ id: "inpost-paczkomat-cod" }, { machine_id: "ksp01m", machine_name: "KSP01M", machine_address: LOCKER }, { currency_code: "pln" })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.deepEqual(ok.data, {
      type: "paczkomat",
      cod: true,
      machine_id: "KSP01M",
      machine_name: "KSP01M",
      machine_address: LOCKER,
      inpost_option: "inpost-paczkomat-cod",
      inpost_kind: "locker",
      inpost_service: "inpost_locker_standard",
      inpost_parcel_size: null,
    })
  }
  const other = validateMethodData({ id: "inpost-paczkomat" }, { target_point: "KSP02A" }, null)
  assert.equal(other.ok && other.data.machine_id, "KSP02A", "the target_point of another storefront works too")
})

test("checkout: a courier option needs a full Polish address; cash on delivery needs PLN", () => {
  const code = (r: ReturnType<typeof validateMethodData>) => (r.ok ? "ok" : r.error.code)
  assert.equal(code(validateMethodData({ id: "inpost-kurier" }, {}, { shipping_address: ADDRESS })), "ok")
  assert.equal(code(validateMethodData({ id: "inpost-kurier" }, {}, { shipping_address: { ...ADDRESS, address_1: "ul. Przykładowa" } })), "address_incomplete")
  assert.equal(code(validateMethodData({ id: "inpost-kurier" }, {}, { shipping_address: { ...ADDRESS, postal_code: "123" } })), "address_incomplete")
  assert.equal(code(validateMethodData({ id: "inpost-kurier" }, {}, { shipping_address: { ...ADDRESS, country_code: "de" } })), "country_unsupported")
  assert.equal(code(validateMethodData({ id: "inpost-kurier" }, {}, { shipping_address: null })), "ok", "no address yet: the plan checks it later")
  assert.equal(code(validateMethodData({ id: "inpost-kurier-cod" }, {}, { currency_code: "eur", shipping_address: ADDRESS })), "currency_unsupported")
  assert.equal(code(validateMethodData({ id: "unknown" }, {}, null)), "option_unknown")
})

test("validateFulfillmentData throws a readable error; a missing locker is refused when the points API says so", async () => {
  await assert.rejects(provider().validateFulfillmentData({ id: "inpost-paczkomat" }, {}, {}), /Choose an InPost parcel locker/)
  const fake = new FakeShipx()
  fake.points = [{ name: "KSP01M", address: { line1: "x", line2: "y" } }]
  globalThis.fetch = fake.fetch as unknown as typeof fetch
  const live = provider({ ...LIVE })
  const data = await live.validateFulfillmentData({ id: "inpost-paczkomat" }, { machine_id: "KSP01M" }, {})
  assert.equal(data.machine_id, "KSP01M")
  await assert.rejects(live.validateFulfillmentData({ id: "inpost-paczkomat" }, { machine_id: "KSP99X" }, {}), /has no parcel locker KSP99X/)
  assert.ok(fake.calls.every((c) => c.auth === null), "the points API is public: no token is ever sent to it")
})

test("the locker check fails open: InPost down never stops a checkout; demo mode never asks", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network down")
  }) as unknown as typeof fetch
  const data = await provider({ ...LIVE }).validateFulfillmentData({ id: "inpost-paczkomat" }, { machine_id: "KSP77A" }, {})
  assert.equal(data.machine_id, "KSP77A")
  let asked = false
  globalThis.fetch = (async () => {
    asked = true
    throw new Error("no")
  }) as unknown as typeof fetch
  await provider({}).validateFulfillmentData({ id: "inpost-paczkomat" }, { machine_id: "KSP01M" }, {})
  assert.equal(asked, false)
})

test("a fulfillment records the choice and the cash on delivery amount, and sends nothing to ShipX", async () => {
  let called = false
  globalThis.fetch = (async () => {
    called = true
    throw new Error("no network in a fulfillment")
  }) as unknown as typeof fetch
  const p = provider({ ...LIVE })
  const res = await p.createFulfillment({ type: "paczkomat", cod: true, machine_id: "KSP01M", machine_name: "KSP01M", machine_address: LOCKER }, [], { currency_code: "pln", total: 249.9 } as never, {})
  assert.equal(called, false)
  assert.deepEqual(res.labels, [])
  assert.equal(res.data.inpost_option, "inpost-paczkomat-cod")
  assert.equal(res.data.inpost_cod_amount, "249.90")
  assert.equal(res.data.machine_id, "KSP01M")
  const eur = await p.createFulfillment({ inpost_option: "inpost-kurier-cod" }, [], { currency_code: "eur", total: 10 } as never, {})
  assert.equal(eur.data.inpost_cod_amount, null)
  assert.deepEqual(readFulfillmentData(res.data)?.spec.id, "inpost-paczkomat-cod")
  assert.deepEqual(await p.cancelFulfillment({}), {})
  /* A return on a delivery option (or with no option at all) is refused, never an empty success. */
  await assert.rejects(() => p.createReturnFulfillment({}), /return option inpost-zwrot/)
  await assert.rejects(() => p.createReturnFulfillment({ shipping_option: { data: { id: "inpost-paczkomat" } } }), /delivery options of InPost take no returns/)
})

test("a return on the return option is recorded like a fulfillment, with no request to InPost", async () => {
  let called = false
  globalThis.fetch = (async () => {
    called = true
    throw new Error("no network in a return")
  }) as unknown as typeof fetch
  const p = provider({ ...LIVE })
  const res = await p.createReturnFulfillment({ id: "ful_ret_1", data: { note: "kept" }, shipping_option: { id: "so_ret", data: { id: "inpost-zwrot" } } })
  assert.equal(called, false)
  assert.deepEqual(res.labels, [])
  assert.equal(res.data.inpost_return, true)
  assert.equal(res.data.inpost_option, "inpost-zwrot")
  assert.equal(res.data.note, "kept")
  /* Choosing the return method needs nothing from the customer. */
  assert.deepEqual(await p.validateFulfillmentData({ id: "inpost-zwrot" }, {}, {}), { inpost_option: "inpost-zwrot", inpost_return: true })
})

test("documents: the label of a fulfillment with a shipment id; a generated PDF in demo mode", async () => {
  const demo = provider({ demo: true })
  assert.deepEqual(await demo.getFulfillmentDocuments({}), [])
  assert.deepEqual(await demo.getFulfillmentDocuments({ inpost_shipment_id: "9123" }), [{ type: "label", shipment_id: "9123", formats: ["A6", "A4"] }])
  const doc = (await demo.retrieveDocuments({ inpost_shipment_id: "9123" }, "label")) as unknown as Record<string, string>
  assert.equal(doc.content_type, "application/pdf")
  assert.ok(Buffer.from(doc.base64, "base64").toString("latin1").startsWith("%PDF-1.4"))
  assert.equal(await demo.retrieveDocuments({ inpost_shipment_id: "9123" }, "invoice"), null)
})
