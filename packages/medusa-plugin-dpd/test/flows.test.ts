/**
 * The server surface end to end on a fake Medusa container and the memory
 * store: recording a DPD fulfillment (only DPD's, once, nothing personal,
 * nothing sent), the routes of lib/contract.ts on their happy paths and
 * their refusals, the writers armed per mode with who and when, reads that
 * never write, the demo routes, and the guards of the middlewares. No
 * database, no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { DemoResetResponse, DemoSeedResponse, ErrorResponse, OrderDpdResponse, ShipmentsResponse, StatusResponse, WritersResponse } from "../src/modules/dpd/lib/contract.ts"
import { onFulfillmentCanceled, recordFulfillment } from "../src/workflows/dpd/shipments.ts"
import dpdFulfillmentCreated, { config as subscriberConfig } from "../src/subscribers/dpd-fulfillment-created.ts"
import dpdFulfillmentCanceled, { config as canceledConfig } from "../src/subscribers/dpd-fulfillment-canceled.ts"
import middlewares from "../src/api/middlewares.ts"
import { GET as getStatus } from "../src/api/admin/dpd/route.ts"
import { GET as getShipments } from "../src/api/admin/dpd/shipments/route.ts"
import { GET as getOrder } from "../src/api/admin/dpd/orders/[orderId]/route.ts"
import { POST as postWriters } from "../src/api/admin/dpd/writers/route.ts"
import { POST as postSeed } from "../src/api/admin/dpd/demo/seed/route.ts"
import { POST as postReset } from "../src/api/admin/dpd/demo/reset/route.ts"
import { order, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in stage 1")
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "stage 1 never calls DPD")
})

const ORDER = "order_01KODA0000000000000000001"
const FUL = "ful_01KODA0000000000000000001"

function withFulfillment(data: Row, over: Row = {}, fulfillment: Row = {}): Row {
  return order({ id: ORDER, fulfillments: [{ id: FUL, provider_id: "dpd_dpd", data, canceled_at: null, ...fulfillment }], ...over })
}

const PICKUP_DATA = { dpd_option: "dpd-pickup-cod", dpd_kind: "pickup", dpd_cod: true, dpd_pudo_id: "PL14509", dpd_country: "PL" }

/* ------------------------------------------------------------------ */
/* A request and a response, as the routes see them                    */
/* ------------------------------------------------------------------ */

type Answer<T> = { status: number; body: T }

async function call<T>(handler: (req: never, res: never) => Promise<void>, s: Setup, req: Row = {}): Promise<Answer<T>> {
  const out: { status: number; body: unknown } = { status: 200, body: undefined }
  const res = {
    status(code: number) {
      out.status = code
      return res
    },
    json(body: unknown) {
      out.body = body
      return res
    },
  }
  await handler({ scope: s.container, query: {}, params: {}, body: {}, headers: {}, auth_context: { actor_id: "user_01ADMIN" }, ...req } as never, res as never)
  return out as Answer<T>
}

/** Counts every write the fakes see: the store, the generated service, the event bus. */
function writesOf(s: Setup): () => string[] {
  const calls: string[] = []
  const wrap = (target: Record<string, unknown>, name: string, pick: (k: string) => boolean) => {
    for (const k of Object.keys(target)) {
      const fn = target[k]
      if (typeof fn !== "function" || !pick(k)) continue
      target[k] = (...args: unknown[]) => {
        calls.push(`${name}.${k}`)
        return (fn as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  wrap(s.store as unknown as Record<string, unknown>, "store", (k) => !["counts", "list", "dispatchCounts", "listDispatches"].includes(k))
  wrap(s.container.resolve<Record<string, unknown>>("dpd"), "dpd", (k) => /^(create|update|delete)/.test(k))
  wrap(s.container.resolve<Record<string, unknown>>("event_bus"), "event_bus", () => true)
  return () => calls
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

test("a fulfillment of another provider is ignored; a DPD one is recorded once, pending, outbound, without personal data", async () => {
  const other = setup(SANDBOX, [withFulfillment(PICKUP_DATA, {}, { provider_id: "manual_manual" })])
  assert.equal(await recordFulfillment(other.container, ORDER, FUL), null)
  assert.equal(other.shipments.rows.length, 0)

  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  const row = await recordFulfillment(s.container, ORDER, FUL)
  assert.ok(row)
  assert.equal(row.state, "pending")
  assert.equal(row.kind, "outbound")
  assert.equal(row.mode, "sandbox")
  assert.equal(row.option_id, "dpd-pickup-cod")
  assert.equal(row.pudo_id, "PL14509")
  assert.equal(row.country_code, "PL")
  assert.equal(row.currency, "PLN")
  assert.equal(row.reference, FUL, "the deterministic reference is the fulfillment id")
  assert.equal(row.cod_minor, null, "the amount is set when the shipment is created")
  const again = await recordFulfillment(s.container, ORDER, FUL)
  assert.equal(again?.id, row.id)
  assert.equal(s.shipments.rows.length, 1, "the same fulfillment never makes a second row")
  assert.equal(s.events.rows.length, 1, "one history line")
  const stored = JSON.stringify(s.shipments.rows) + JSON.stringify(s.events.rows)
  for (const personal of ["Anna", "Nowak", "anna@example.com", "+48 000 000 002", "Przykładowa"]) assert.ok(!stored.includes(personal), personal)
})

test("the choice comes from the fulfillment data, else from the shipping method; a canceled fulfillment is recorded canceled; the return option is not an outbound row", async () => {
  const fromMethod = setup(SANDBOX, [withFulfillment({ some: "thing" })])
  const row = await recordFulfillment(fromMethod.container, ORDER, FUL)
  assert.equal(row?.option_id, "dpd-courier", "the shipping method of the order")
  assert.equal(row?.pudo_id, null)
  assert.equal(row?.country_code, "PL")

  const canceled = setup(SANDBOX, [withFulfillment(PICKUP_DATA, {}, { canceled_at: new Date() })])
  assert.equal((await recordFulfillment(canceled.container, ORDER, FUL))?.state, "canceled")

  const abroad = setup(SANDBOX, [withFulfillment({ dpd_option: "dpd-courier", dpd_country: null }, { shipping_address: { country_code: "de" } })])
  assert.equal((await recordFulfillment(abroad.container, ORDER, FUL))?.country_code, "DE")

  const ret = setup(SANDBOX, [withFulfillment({ dpd_option: "dpd-return" })])
  assert.equal(await recordFulfillment(ret.container, ORDER, FUL), null)
  const none = setup(SANDBOX, [withFulfillment({}, { shipping_methods: [] })])
  assert.equal(await recordFulfillment(none.container, ORDER, FUL), null)
  assert.ok(none.logs.some((l) => l.includes("no DPD option")))
  assert.equal(await recordFulfillment(none.container, "order_missing", FUL), null)
})

/* What Medusa copies into the shipping method of a claim, an exchange, an order edit or a draft order: the option's own data. */
const OPTION_COURIER = { id: "dpd-courier", name: "DPD courier", kind: "courier", cod: false, is_return: false }
const OPTION_PICKUP = { id: "dpd-pickup", name: "DPD Pickup", kind: "pickup", cod: false, is_return: false }
const CHECKOUT_PICKUP = { id: "sm_checkout", name: "DPD Pickup", shipping_option_id: "so_pickup", data: { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL14509", dpd_country: "PL" } }
const CLAIM_COURIER = { id: "sm_claim", name: "DPD courier", shipping_option_id: "so_courier", data: OPTION_COURIER }

test("several DPD methods: the one of the fulfillment's shipping option; without one, the method the checkout validated", async () => {
  const methods = { shipping_methods: [CHECKOUT_PICKUP, CLAIM_COURIER] }
  const claim = setup(SANDBOX, [withFulfillment({}, methods, { shipping_option_id: "so_courier" })])
  const row = await recordFulfillment(claim.container, ORDER, FUL)
  assert.equal(row?.option_id, "dpd-courier", "the claim's courier, not the first DPD method")
  assert.equal(row?.pudo_id, null)
  assert.equal(row?.country_code, "PL")

  const checkout = setup(SANDBOX, [withFulfillment({}, methods, { shipping_option_id: "so_pickup" })])
  assert.equal((await recordFulfillment(checkout.container, ORDER, FUL))?.pudo_id, "PL14509")
  const unknown = setup(SANDBOX, [withFulfillment({}, { shipping_methods: [CLAIM_COURIER, CHECKOUT_PICKUP] }, { shipping_option_id: null })])
  assert.equal((await recordFulfillment(unknown.container, ORDER, FUL))?.option_id, "dpd-pickup", "no option: the method the checkout validated")

  /* Fulfillment data in the option's shape: recorded, with the point of the method of the same option. */
  const shaped = setup(SANDBOX, [withFulfillment({ ...OPTION_PICKUP }, methods, { shipping_option_id: "so_pickup" })])
  const pickup = await recordFulfillment(shaped.container, ORDER, FUL)
  assert.equal(pickup?.option_id, "dpd-pickup")
  assert.equal(pickup?.pudo_id, "PL14509")
  assert.equal(pickup?.country_code, "PL")
  const draft = setup(SANDBOX, [withFulfillment({ ...OPTION_COURIER }, { shipping_methods: [{ ...CLAIM_COURIER, shipping_option_id: "so_courier" }] })])
  assert.equal((await recordFulfillment(draft.container, ORDER, FUL))?.option_id, "dpd-courier", "a draft order without checkout data is DPD's too")
})

test("recording trusts the order, not the checkout: the courier's country from the address, the plan's problems on the row (E18)", async () => {
  const codes = (row: Row | null) => ((row?.problems as Array<{ code: string }> | null) ?? []).map((p) => p.code)
  /* A courier order and a Pickup order (PL14509 of the sandbox catalog) with the variant weights plan clean. */
  const weighed = { items: [{ id: "li_1", quantity: 2, variant: { weight: 1200 } }] }
  const clean = setup(SANDBOX, [withFulfillment({ dpd_option: "dpd-courier", dpd_country: "PL" }, weighed)])
  assert.equal((await recordFulfillment(clean.container, ORDER, FUL))?.problems, null, "a courier order that plans has no problems")
  const pickup = setup(SANDBOX, [withFulfillment(PICKUP_DATA, weighed)])
  assert.equal((await recordFulfillment(pickup.container, ORDER, FUL))?.problems, null, "a Pickup order that plans has no problems (stage 3)")
  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  assert.deepEqual(codes(await recordFulfillment(s.container, ORDER, FUL)), ["weight_missing"], "Pickup is planned like the courier")
  const noWeight = setup(SANDBOX, [withFulfillment({ dpd_option: "dpd-courier", dpd_country: "PL" })])
  assert.deepEqual(codes(await recordFulfillment(noWeight.container, ORDER, FUL)), ["weight_missing"], "no variant weight and no default box")

  /* The checkout saw Poland; the address was changed to Germany afterwards. */
  const moved = setup(SANDBOX, [
    withFulfillment({ dpd_option: "dpd-courier-cod", dpd_kind: "courier", dpd_cod: true, dpd_country: "PL" }, { shipping_address: { address_1: "Musterstr. 1", city: "Berlin", postal_code: "10115", country_code: "de", phone: "+49 000 0000" } }),
  ])
  const row = await recordFulfillment(moved.container, ORDER, FUL)
  assert.equal(row?.country_code, "DE", "the address of the order, not the checkout's country")
  assert.deepEqual(codes(row), ["receiver_name_missing", "abroad_later", "weight_missing", "cod_country_unsupported"])
  assert.match(String(moved.events.rows[0].message), /cod_country_unsupported/)

  const outside = setup({ ...SANDBOX, countries: "PL" }, [withFulfillment({ dpd_option: "dpd-courier", dpd_country: "PL" }, { shipping_address: { address_1: "Musterstr. 1", city: "Berlin", postal_code: "10115", country_code: "de" } })])
  assert.ok(codes(await recordFulfillment(outside.container, ORDER, FUL)).includes("country_unsupported"))
  const noAddress = setup(SANDBOX, [withFulfillment({ dpd_option: "dpd-courier", dpd_country: "PL" }, { shipping_address: null })])
  const bare = await recordFulfillment(noAddress.container, ORDER, FUL)
  assert.equal(bare?.country_code, null)
  assert.deepEqual(codes(bare), ["address_incomplete", "weight_missing"])
  const currency = setup(SANDBOX, [withFulfillment({ dpd_option: "dpd-pickup-cod", dpd_pudo_id: "PL14509" }, { currency_code: "eur" })])
  const eur = await recordFulfillment(currency.container, ORDER, FUL)
  assert.equal(eur?.country_code, "PL", "a Pickup point keeps the country of its id")
  assert.deepEqual(codes(eur), ["weight_missing", "cod_currency_unsupported"])
  assert.match(String(currency.events.rows[0].message), /cod_currency_unsupported/, "the checks of the checkout still speak in the history")
  const noPoint = setup(SANDBOX, [withFulfillment({ ...OPTION_PICKUP }, { shipping_methods: [] })])
  assert.deepEqual(codes(await recordFulfillment(noPoint.container, ORDER, FUL)), ["pudo_missing", "weight_missing"], "no point in the data: the plan asks for one")

  for (const x of [moved, outside, noAddress, currency]) {
    const stored = JSON.stringify(x.shipments.rows) + JSON.stringify(x.events.rows)
    for (const personal of ["Musterstr", "Berlin", "10115", "+49", "Anna", "anna@example.com", "Przykładowa", "+48 000 000 002"]) assert.ok(!stored.includes(personal), personal)
  }
})

test("a canceled fulfillment cancels its row when nothing was sent; a row DPD has stays and is flagged once", async () => {
  assert.equal(canceledConfig.event, "order.fulfillment_canceled")
  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  const row = await recordFulfillment(s.container, ORDER, FUL)
  s.shipments.insert({ mode: "demo", kind: "outbound", option_id: "dpd-courier", fulfillment_id: FUL, state: "pending" })
  await dpdFulfillmentCanceled({ event: { data: { order_id: ORDER, fulfillment_id: FUL } }, container: s.container } as never)
  await dpdFulfillmentCanceled({ event: { data: { order_id: ORDER, fulfillment_id: FUL } }, container: s.container } as never)
  await dpdFulfillmentCanceled({ event: { data: {} }, container: s.container } as never)
  assert.equal(s.shipments.rows.find((r) => r.id === row?.id)?.state, "canceled")
  assert.equal(s.shipments.rows.find((r) => r.mode === "demo")?.state, "pending", "another mode is never touched")
  assert.equal(s.events.rows.filter((e) => (e.data as Row | null)?.action === "fulfillment_canceled").length, 1, "idempotent")
  assert.equal(await onFulfillmentCanceled(s.container, "ful_unknown"), null)

  for (const state of ["failed", "skipped"]) {
    const x = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
    const r = await recordFulfillment(x.container, ORDER, FUL)
    await x.store.transition(String(r?.id), ["pending"], { state })
    assert.equal((await onFulfillmentCanceled(x.container, FUL))?.state, "canceled", state)
  }

  const sent = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  const created = await recordFulfillment(sent.container, ORDER, FUL)
  await sent.store.transition(String(created?.id), ["pending"], { state: "labeled", waybills: ["99000000000001D"] })
  const kept = await onFulfillmentCanceled(sent.container, FUL)
  assert.equal(kept?.state, "labeled", "DPD cannot cancel a shipment: the row says what DPD has")
  await onFulfillmentCanceled(sent.container, FUL)
  const flagged = sent.events.rows.filter((e) => (e.data as Row | null)?.action === "fulfillment_canceled")
  assert.equal(flagged.length, 1, "flagged once")
  assert.equal((flagged[0].data as Row).outcome, "kept")
  assert.ok(sent.logs.some((l) => l.startsWith("warn") && l.includes("left as it is")))

  /* The row was pending when read, but another writer moved it before the cancel landed. */
  const raced = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  const racing = await recordFulfillment(raced.container, ORDER, FUL)
  const transition = raced.store.transition.bind(raced.store)
  raced.store.transition = async (id, from, patch, expect) => {
    await transition(id, ["pending"], { state: "creating" })
    return transition(id, from, patch, expect)
  }
  const lost = await onFulfillmentCanceled(raced.container, FUL)
  assert.equal(lost?.state, "creating", "the row as it is now, not as it was read")
  const line = raced.events.rows.find((e) => (e.data as Row | null)?.action === "fulfillment_canceled")
  assert.equal((line?.data as Row).state, "creating")
  assert.ok(String(line?.message).includes("(creating)"))
  assert.ok(raced.logs.some((l) => l.startsWith("warn") && l.includes(`${racing?.id} is creating`)))

  /* Another cancel won the race: the row is canceled, nothing more to say. */
  const twice = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  await recordFulfillment(twice.container, ORDER, FUL)
  const first = twice.store.transition.bind(twice.store)
  twice.store.transition = async (id, from, patch, expect) => {
    await first(id, from, patch, expect)
    return first(id, from, patch, expect)
  }
  assert.equal((await onFulfillmentCanceled(twice.container, FUL))?.state, "canceled")
  assert.equal(twice.events.rows.filter((e) => (e.data as Row | null)?.action === "fulfillment_canceled").length, 0, "no kept line for a row another cancel canceled")

  /* The row moved to creating and back to failed between the two reads: one more try cancels it. */
  const back = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  await recordFulfillment(back.container, ORDER, FUL)
  const plain = back.store.transition.bind(back.store)
  let raced1 = false
  back.store.transition = async (id, from, patch, expect) => {
    if (raced1) return plain(id, from, patch, expect)
    raced1 = true
    await plain(id, ["pending"], { state: "creating" })
    const lost1 = await plain(id, from, patch, expect)
    await plain(id, ["creating"], { state: "failed" })
    return lost1
  }
  assert.equal((await onFulfillmentCanceled(back.container, FUL))?.state, "canceled")
  const backLine = back.events.rows.find((e) => (e.data as Row | null)?.action === "fulfillment_canceled")
  assert.equal((backLine?.data as Row).outcome, "canceled")
})

test("GET /admin/dpd/orders/:orderId with a claim's method first: the choice is the checkout's", async () => {
  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA, { shipping_methods: [CLAIM_COURIER, CHECKOUT_PICKUP] })])
  const { body } = await call<OrderDpdResponse>(getOrder, s, { params: { orderId: ORDER } })
  assert.deepEqual(body.chosen, { optionId: "dpd-pickup", optionKind: "pickup", cod: false, pudoId: "PL14509", country: "PL", methodName: "DPD Pickup" })
  const draft = setup(SANDBOX, [withFulfillment(PICKUP_DATA, { shipping_methods: [CLAIM_COURIER] })])
  assert.equal((await call<OrderDpdResponse>(getOrder, draft, { params: { orderId: ORDER } })).body.chosen?.optionId, "dpd-courier", "option-shaped data alone is DPD's")
})

test("the subscriber of order.fulfillment_created records through the same function, per mode", async () => {
  assert.equal(subscriberConfig.event, "order.fulfillment_created")
  const s = setup({ demo: true }, [withFulfillment(PICKUP_DATA)])
  await dpdFulfillmentCreated({ event: { data: { order_id: ORDER, fulfillment_id: FUL } }, container: s.container } as never)
  await dpdFulfillmentCreated({ event: { data: { order_id: ORDER, fulfillment_id: FUL } }, container: s.container } as never)
  await dpdFulfillmentCreated({ event: { data: {} }, container: s.container } as never)
  assert.equal(s.shipments.rows.length, 1)
  assert.equal(s.shipments.rows[0].mode, "demo")
})

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

test("GET /admin/dpd: the status of the mode, never a secret, and nothing written", async () => {
  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  await recordFulfillment(s.container, ORDER, FUL)
  const writes = writesOf(s)
  const { status, body } = await call<StatusResponse>(getStatus, s)
  assert.equal(status, 200)
  assert.equal(body.mode, "sandbox")
  assert.equal(body.demo, false)
  assert.equal(body.configured, true)
  assert.deepEqual(body.missing, [])
  assert.deepEqual(body.senderProblems, [])
  assert.equal(body.counts.to_create, 1)
  assert.equal(body.counts.attention, 1)
  assert.equal(body.options.credentials.password, "set")
  assert.equal(body.options.credentials.pickupApiKey, "missing")
  assert.equal(body.writers.shipment.allowed, false, "writers are off outside demo mode by default")
  assert.equal(body.settings.labelPage, "A4")
  assert.equal(body.demoSeeded, false)
  assert.match(body.version, /^\d+\.\d+\.\d+/)
  assert.ok(!JSON.stringify(body).includes(String(SANDBOX.password)), "never a secret")
  assert.deepEqual(writes(), [], "reads never write")

  const bare = await call<StatusResponse>(getStatus, setup({}))
  assert.equal(bare.body.configured, false)
  assert.deepEqual(bare.body.missing, ["login", "password", "masterFid"])
})

test("GET /admin/dpd/shipments: a page of a Panel list of the current mode, the search, the counts; a bad filter is refused", async () => {
  const s = setup({ demo: true }, Array.from({ length: 16 }, (_, i) => order({ id: `order_D${String(i).padStart(3, "0")}`, display_id: 3000 + i, created_at: new Date(Date.UTC(2026, 10, 1, 8, i)) })))
  await call<DemoSeedResponse>(postSeed, s)
  s.shipments.insert({ mode: "live", kind: "outbound", option_id: "dpd-courier", state: "pending", stage: null, handed_over_at: null })
  const writes = writesOf(s)
  const all = await call<ShipmentsResponse>(getShipments, s, { query: { limit: "5" } })
  assert.equal(all.status, 200)
  assert.equal(all.body.count, 16, "the live row is another mode")
  assert.equal(all.body.shipments.length, 5)
  assert.equal(all.body.limit, 5)
  assert.equal(all.body.counts.all, 16)
  assert.ok(all.body.shipments.every((x) => x.demo && x.mode === "demo"))
  const problems = await call<ShipmentsResponse>(getShipments, s, { query: { filter: "problems" } })
  assert.equal(problems.body.count, all.body.counts.problems)
  assert.ok(problems.body.shipments.every((x) => x.group === "problems"))
  const one = all.body.shipments.find((x) => x.waybills.length > 0) ?? problems.body.shipments[0]
  const search = await call<ShipmentsResponse>(getShipments, s, { query: { q: `#${one.displayId}` } })
  assert.deepEqual(search.body.shipments.map((x) => x.id), [one.id])
  const bad = await call<ErrorResponse>(getShipments, s, { query: { filter: "everything" } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, "invalid")
  assert.deepEqual(writes(), [], "reads never write")
})

test("GET /admin/dpd/orders/:orderId: the choice, the shipments of the mode with their history, the writers; 404 for no order", async () => {
  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA, { shipping_methods: [{ id: "sm_01", name: "DPD Pickup", data: PICKUP_DATA }] })])
  await recordFulfillment(s.container, ORDER, FUL)
  s.shipments.insert({ mode: "demo", order_id: ORDER, kind: "outbound", option_id: "dpd-courier", state: "failed" })
  const writes = writesOf(s)
  const { status, body } = await call<OrderDpdResponse>(getOrder, s, { params: { orderId: ORDER } })
  assert.equal(status, 200)
  assert.deepEqual(body.chosen, { optionId: "dpd-pickup-cod", optionKind: "pickup", cod: true, pudoId: "PL14509", country: "PL", methodName: "DPD Pickup" })
  assert.equal(body.shipments.length, 1, "the demo row is another mode")
  assert.equal(body.shipments[0].group, "to_create")
  assert.equal(body.shipments[0].cod, true)
  assert.equal(body.events.length, 1)
  assert.equal(body.events[0].kind, "action")
  assert.equal(body.mode, "sandbox")
  assert.deepEqual(Object.keys(body.writers).sort(), ["fulfillmentStatus", "pickup", "shipment"])
  assert.deepEqual(writes(), [], "reads never write")
  const missing = await call<ErrorResponse>(getOrder, s, { params: { orderId: "order_NOPE" } })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, "not_found")
  assert.equal((await call<ErrorResponse>(getOrder, s, { params: { orderId: "../x" } })).status, 400)
})

test("POST /admin/dpd/writers: refuses a writer the options turn off, arms per mode with who and when, refuses nonsense", async () => {
  const off = setup(SANDBOX)
  const refused = await call<ErrorResponse>(postWriters, off, { body: { writer: "shipment", armed: true } })
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, "writer_off")
  assert.match(refused.body.message, /shipmentWriter/)
  assert.equal(off.settings.rows.length, 0)
  const disarm = await call<WritersResponse>(postWriters, off, { body: { writer: "shipment", armed: false } })
  assert.equal(disarm.status, 200, "disarming is always allowed")

  const s = setup({ ...SANDBOX, shipmentWriter: true, pickupWriter: "true" })
  const armed = await call<WritersResponse>(postWriters, s, { body: { writer: "pickup", armed: true } })
  assert.equal(armed.status, 200)
  assert.equal(armed.body.writers.pickup.armed, true)
  assert.equal(armed.body.writers.pickup.updatedBy, "user_01ADMIN")
  assert.ok(armed.body.writers.pickup.updatedAt)
  assert.equal(armed.body.writers.shipment.armed, false)
  assert.deepEqual(s.settings.rows.map((r) => r.key), ["sandbox:writer:pickup"], "the toggle of the sandbox only")
  await call<WritersResponse>(postWriters, s, { body: { writer: "pickup", armed: true } })
  assert.equal(s.settings.rows.length, 1)
  assert.equal((await call<WritersResponse>(postWriters, s, { body: { writer: "pickup", armed: false } })).body.writers.pickup.armed, false)
  assert.equal((await call<ErrorResponse>(postWriters, s, { body: { writer: "labels", armed: true } })).body.code, "writer_unknown")
  assert.equal((await call<ErrorResponse>(postWriters, s, { body: { writer: "shipment", armed: "yes" } })).status, 400)
})

test("the demo routes: only in demo mode, the seed once, the reset of demo rows only", async () => {
  const live = setup(SANDBOX, [order()])
  assert.equal((await call<ErrorResponse>(postSeed, live)).status, 409)
  assert.equal((await call<ErrorResponse>(postReset, live)).body.code, "not_demo")
  assert.equal(live.shipments.rows.length, 0)

  const s = setup({ demo: true }, Array.from({ length: 3 }, (_, i) => order({ id: `order_S${i}`, display_id: 10 + i })))
  const first = await call<DemoSeedResponse>(postSeed, s)
  assert.deepEqual(first.body, { seeded: true, created: 3, mode: "demo" })
  assert.deepEqual((await call<DemoSeedResponse>(postSeed, s)).body, { seeded: false, created: 0, mode: "demo" })
  assert.equal((await call<StatusResponse>(getStatus, s)).body.demoSeeded, true)
  const reset = await call<DemoResetResponse>(postReset, s)
  assert.deepEqual(reset.body.removed, { shipments: 3, documents: 0, events: 3, dispatches: 0, settings: 1 })
  assert.equal((await call<StatusResponse>(getStatus, s)).body.demoSeeded, false)
})

test("middlewares: a write guard on /admin/dpd*, the dpd_ metadata keys refused on the store routes", async () => {
  const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Array<(req: never, res: never, next: () => void) => void> }> }).routes
  const admin = routes.find((r) => r.matcher === "/admin/dpd*")
  assert.ok(admin)
  const run = (mw: (req: never, res: never, next: () => void) => void, req: Row) => {
    const out = { status: 0, next: false }
    const res = { status: (c: number) => ((out.status = c), res), json: () => res }
    mw(req as never, res as never, () => void (out.next = true))
    return out
  }
  assert.equal(run(admin.middlewares[0], { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).status, 415)
  assert.equal(run(admin.middlewares[0], { method: "POST", headers: { "content-type": "application/json" } }).next, true)
  const cart = routes.find((r) => r.matcher === "/store/carts*")
  assert.ok(cart)
  assert.equal(run(cart.middlewares[0], { method: "POST", body: { metadata: { DPD_pudo_id: "PL14509" } } }).status, 400)
  assert.equal(run(cart.middlewares[0], { method: "POST", body: { metadata: { gift: true } } }).next, true)
  assert.ok(routes.some((r) => r.matcher === "/store/customers/me*"))
})

test("excluded is cancelable with the fulfillment", async () => {
  const s = setup(SANDBOX, [withFulfillment(PICKUP_DATA)])
  const row = await recordFulfillment(s.container, ORDER, FUL)
  await s.store.transition(String(row?.id), ["pending"], { state: "labeled", waybills: ["99000000000001D"] })
  await s.store.transition(String(row?.id), ["labeled"], { state: "excluded" }, { dispatch_id: null })
  assert.equal((await onFulfillmentCanceled(s.container, FUL))?.state, "canceled", "do not send, then canceled in Medusa: nothing is left to send")
})
