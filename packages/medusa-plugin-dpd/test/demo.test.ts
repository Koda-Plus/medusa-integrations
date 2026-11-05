/**
 * Demo mode: sample shipments built once from the store's own orders,
 * deterministic, written in mode "demo" and never mixed with sandbox or live
 * rows, invented points and waybills that look invented, every Panel list
 * filled; the seed only in demo mode and only once; the reset removes demo
 * rows and demo keys and nothing else. Pickup checks its points in the
 * sample catalog and is created by the simulated DPD. Nothing is sent
 * anywhere.
 */
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { PUDO_ID_PATTERN, SHIPMENT_STAGES, SHIPMENT_STATES } from "../src/modules/dpd/lib/constants.ts"
import { SHIPMENT_GROUPS } from "../src/modules/dpd/lib/contract.ts"
import { DEMO_POINTS, demoRows, demoWaybill, isDemoPoint } from "../src/modules/dpd/lib/demo.ts"
import { countsOf, rowGroup } from "../src/modules/dpd/lib/dto.ts"
import { validateMethodData } from "../src/modules/dpd/lib/option-data.ts"
import { ensureDemoSeed, resetDemo } from "../src/workflows/dpd/demo.ts"
import { createShipment } from "../src/workflows/dpd/create.ts"
import { createDemoDpdServicesClient } from "../src/workflows/dpd/demo-client.ts"
import { planForShipment } from "../src/workflows/dpd/plan.ts"
import { recordFulfillment } from "../src/workflows/dpd/shipments.ts"
import { courierDays } from "../src/modules/dpd/lib/courier.ts"
import { PROTOCOL_LEASE_MS } from "../src/modules/dpd/lib/constants.ts"
import { cancelCourier, cancelDispatch, createDispatch, expireDispatches, orderCourier, planDispatch, withdrawShipment } from "../src/workflows/dpd/dispatch.ts"
import DpdFulfillmentProvider from "../src/providers/dpd/service.ts"
import { arm, insertLabeled, labeledOrder, order, SANDBOX, setup, type Row } from "./helpers.ts"

const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in demo mode")
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "demo mode never calls anything")
})

const orders = (n: number, currency = "pln") =>
  Array.from({ length: n }, (_, i) => order({ id: `order_DEMO${String(i).padStart(4, "0")}`, display_id: 2000 + i, currency_code: currency, total: 100 + i + 0.5, created_at: new Date(Date.UTC(2026, 9, 1, 8, i)) }))

const newestFirst = (list: Row[]) => [...list].sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime()) as Array<Row & { id: string }>

test("the same orders give the same rows, and together they fill every list of the Panel", () => {
  const now = new Date("2026-11-02T12:00:00Z")
  const a = demoRows(newestFirst(orders(16)), now)
  const b = demoRows(newestFirst(orders(16)), now)
  assert.deepEqual(a, b)
  assert.equal(a.length, 16)
  assert.ok(a.every((r) => r.mode === "demo"))
  const groups = new Set(a.map((r) => rowGroup(r)))
  for (const g of SHIPMENT_GROUPS) assert.ok(groups.has(g), `the demo fills ${g}`)
  assert.ok(a.every((r) => (SHIPMENT_STATES as readonly string[]).includes(r.state)))
  assert.ok(a.every((r) => r.stage === null || (SHIPMENT_STAGES as readonly string[]).includes(r.stage)))
  assert.ok(a.every((r) => r.status === null), "no InfoServices code is invented")
  assert.ok(a.every((r) => r.fulfillment_id === null), "no row claims a real fulfillment")
  assert.ok(a.some((r) => r.country_code !== "PL" && r.session_type === "INTERNATIONAL"), "one shipment goes abroad")
  assert.ok(a.some((r) => (r.waybills?.length ?? 0) > 1), "one shipment has several boxes")
})

test("invented Pickup points and waybills look invented, and the checkout would still take the points", () => {
  assert.ok(DEMO_POINTS.every((p) => PUDO_ID_PATTERN.test(p) && p.includes("DEMO")))
  assert.ok(DEMO_POINTS.every((p) => validateMethodData({ id: "dpd-pickup" }, { pudo_id: p }, null).ok))
  const rows = demoRows(newestFirst(orders(16)), new Date())
  assert.ok(rows.every((r) => r.pudo_id === null || isDemoPoint(r.pudo_id)))
  const waybills = rows.flatMap((r) => r.waybills ?? [])
  assert.ok(waybills.length > 10)
  assert.ok(waybills.every((w) => /^99\d{11}D$/.test(w)))
  assert.equal(new Set(waybills).size, waybills.length, "every box has its own waybill")
  assert.equal(demoWaybill("x"), demoWaybill("x"))
})

test("cash on delivery only in PLN, with the amount once DPD gave the numbers; fewer orders, fewer rows", () => {
  const eur = demoRows(newestFirst(orders(16, "eur")), new Date())
  assert.ok(eur.every((r) => !r.option_id.endsWith("-cod") && r.cod_minor === null))
  const pln = demoRows(newestFirst(orders(16)), new Date())
  assert.ok(pln.some((r) => r.option_id.endsWith("-cod") && r.cod_minor !== null))
  assert.ok(pln.filter((r) => r.state === "pending").every((r) => r.cod_minor === null), "no amount before creation")
  assert.ok(pln.filter((r) => r.option_id === "dpd-pickup-cod").every((r) => r.country_code === "PL"))
  assert.equal(demoRows(orders(3), new Date()).length, 3)
})

test("the seed: demo mode only, once (the demo:seeded key), from the newest orders, with history", async () => {
  const s = setup({ demo: true }, orders(20))
  assert.equal(await ensureDemoSeed(s.container), 16)
  assert.equal(await ensureDemoSeed(s.container), 0, "the key is claimed")
  assert.equal(s.shipments.rows.length, 16)
  assert.ok(s.shipments.rows.every((r) => r.mode === "demo"))
  assert.equal(s.shipments.rows.at(-1)?.order_id, "order_DEMO0019", "the newest order is the newest row")
  assert.equal(s.events.rows.length, 16)
  assert.ok(s.events.rows.every((e) => e.mode === "demo" && e.source === "demo"))
  assert.equal(s.settings.rows.filter((r) => r.key === "demo:seeded").length, 1)
  const counts = countsOf(await s.store.counts("demo"))
  assert.equal(counts.all, 16)
  assert.ok(SHIPMENT_GROUPS.every((g) => counts[g] > 0))
  const cod = s.shipments.rows.find((r) => r.option_id === "dpd-courier-cod" && r.state === "labeled")
  const n = Number(String(cod?.order_id).slice(-4))
  assert.equal(cod?.cod_minor, (100 + n) * 100 + 50, "the order total in grosze, read one order at a time")

  const sandbox = setup(SANDBOX, orders(5))
  assert.equal(await ensureDemoSeed(sandbox.container), 0, "never outside demo mode")
  assert.equal(sandbox.shipments.rows.length + sandbox.settings.rows.length, 0)
  const empty = setup({ demo: true }, [])
  assert.equal(await ensureDemoSeed(empty.container), 0)
  assert.equal(empty.settings.rows.length, 0, "no orders: nothing claimed, the next visit tries again")
})

test("a seed that fails half way gives the claim back: no half set, no seeded key, the next visit builds all of it", async () => {
  const s = setup({ demo: true }, orders(6))
  const svc = s.container.resolve<Record<string, (...args: unknown[]) => Promise<unknown>>>("dpd")
  const create = svc.createDpdShipments
  let calls = 0
  svc.createDpdShipments = async (...args: unknown[]) => {
    calls += 1
    if (calls === 3) throw new Error("connection lost")
    return create(...args)
  }
  await assert.rejects(ensureDemoSeed(s.container), /connection lost/)
  assert.equal(s.shipments.rows.length, 0, "the rows of the failed build are removed")
  assert.equal(s.events.rows.length, 0, "with their history")
  assert.equal(s.settings.rows.filter((r) => r.key === "demo:seeded").length, 0, "the key is deleted for good, not soft deleted")
  svc.createDpdShipments = create
  assert.equal(await ensureDemoSeed(s.container), 6, "the next visit builds the whole set")
  assert.equal(await ensureDemoSeed(s.container), 0)
})

test("a failed seed whose rows cannot all be removed keeps the claim: no second set beside them, the log asks for a Reset", async () => {
  const s = setup({ demo: true }, orders(6))
  const svc = s.container.resolve<Record<string, (...args: unknown[]) => Promise<unknown>>>("dpd")
  const create = svc.createDpdShipments
  let calls = 0
  svc.createDpdShipments = async (...args: unknown[]) => {
    calls += 1
    if (calls === 3) throw new Error("connection lost")
    return create(...args)
  }
  const remove = svc.deleteDpdShipments
  svc.deleteDpdShipments = async () => {
    throw new Error("database gone")
  }
  await assert.rejects(ensureDemoSeed(s.container), /connection lost/, "the error of the build, not the one of the cleanup")
  assert.equal(s.shipments.rows.filter((r) => !r.deleted_at).length, 2, "the rows built before the failure are left")
  assert.equal(s.settings.rows.filter((r) => r.key === "demo:seeded").length, 1, "the key stays claimed")
  assert.ok(s.logs.some((l) => l.startsWith("error") && l.includes("reset the demo")))
  svc.createDpdShipments = create
  svc.deleteDpdShipments = remove
  assert.equal(await ensureDemoSeed(s.container), 0, "no second set beside the leftovers")
  assert.equal(s.shipments.rows.filter((r) => !r.deleted_at).length, 2)
  await resetDemo(s.container)
  assert.equal(await ensureDemoSeed(s.container), 6, "after a Reset the whole set is built")
})

test("reset: demo rows and demo keys go, everything else stays; the next seed builds them again", async () => {
  const s = setup({ demo: true }, orders(4))
  await ensureDemoSeed(s.container)
  arm(s, "shipment")
  s.settings.insert({ key: "live:writer:shipment", value: { on: true }, updated_by: "user_01LIVE" })
  s.settings.insert({ key: "sandbox:settings", value: { labelPage: "LBL_PRINTER" }, updated_by: "user_01LIVE" })
  s.shipments.insert({ mode: "live", option_id: "dpd-courier", order_id: "order_LIVE", fulfillment_id: "ful_LIVE", state: "labeled" })
  s.events.insert({ mode: "live", kind: "action", shipment_id: null, order_id: "order_LIVE" })
  s.documents.insert({ mode: "demo", type: "label", data: "JVBERi0=", shipment_id: s.shipments.rows[0].id })
  s.documents.insert({ mode: "sandbox", type: "label", data: "JVBERi0=", shipment_id: "dpdshp_x" })
  s.dispatches.insert({ mode: "demo" })
  const removed = await resetDemo(s.container)
  assert.deepEqual(removed, { shipments: 4, documents: 1, events: 4, dispatches: 1, settings: 2 })
  assert.deepEqual(s.shipments.rows.map((r) => r.mode), ["live"])
  assert.deepEqual(s.events.rows.map((r) => r.mode), ["live"])
  assert.deepEqual(s.documents.rows.map((r) => r.mode), ["sandbox"])
  assert.deepEqual(s.settings.rows.map((r) => r.key).sort(), ["live:writer:shipment", "sandbox:settings"])
  assert.equal(await ensureDemoSeed(s.container), 4, "the next visit builds them again")

  const live = setup(SANDBOX, orders(2))
  live.shipments.insert({ mode: "demo", option_id: "dpd-courier", state: "pending" })
  assert.deepEqual(await resetDemo(live.container), { shipments: 0, documents: 0, events: 0, dispatches: 0, settings: 0 }, "never outside demo mode")
  assert.equal(live.shipments.rows.length, 1)
})

/* Stage 3: Pickup in demo mode (spec 12.3). */

const weighed = (n: number) => orders(n).map((o) => ({ ...o, items: [{ id: "li_1", quantity: 1, variant: { weight: 1500 } }] }))

test("the pending Pickup row of the seed has a clean plan on a point of the sample catalog; an id outside it is pudo_not_found", async () => {
  const s = setup({ demo: true }, weighed(20))
  await ensureDemoSeed(s.container)
  const row = s.shipments.rows.find((r) => r.option_id === "dpd-pickup-cod" && r.state === "pending")
  assert.ok(row)
  const { plan } = await planForShipment(s.container, String(row.id))
  assert.deepEqual(plan.problems, [])
  assert.equal(plan.ok, true)
  assert.equal(plan.point?.status, "ok")
  assert.ok(isDemoPoint(plan.point?.pudoId ?? ""))
  row.pudo_id = "PL14509"
  const outside = await planForShipment(s.container, String(row.id))
  assert.deepEqual(outside.plan.problems.map((p) => p.code), ["pudo_not_found"], "the catalog of demo mode is the whole world of demo mode")
})

test("a Pickup shipment in demo mode is created and labeled by the simulated DPD, without one fetch; the simulated DPD refuses what the demo host refuses", async () => {
  const data = { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL9DEMO02", dpd_country: "PL" }
  const pickup = order({
    id: "order_DEMOPICKUP",
    items: [{ id: "li_1", quantity: 1, variant: { weight: 1500 } }],
    shipping_methods: [{ id: "sm_01", name: "DPD Pickup", shipping_option_id: "so_01", data }],
    fulfillments: [{ id: "ful_DEMOPICKUP", provider_id: "dpd_dpd", data, canceled_at: null }],
  })
  const s = setup({ demo: true, shipmentWriter: true }, [pickup])
  arm(s, "shipment")
  const recorded = await recordFulfillment(s.container, "order_DEMOPICKUP", "ful_DEMOPICKUP")
  assert.ok(recorded)
  const { plan } = await planForShipment(s.container, String(recorded.id))
  assert.equal(plan.ok, true)
  const done = await createShipment(s.container, String(recorded.id), { planHash: plan.hash, actor: "user_01ADMIN", trigger: "manual" })
  assert.equal(done.state, "labeled")
  assert.equal(done.service, "pickup")
  assert.match(String(done.waybills?.[0]), /^99\d{11}D$/)

  assert.ok(plan.request)
  const base = plan.request
  const client = createDemoDpdServicesClient()
  const refused = async (change: (pkg: (typeof base)["packages"][0]) => void): Promise<string[]> => {
    const body = structuredClone(base)
    const pkg = body.packages[0]
    pkg.reference = `${pkg.reference}-${Math.random()}`
    change(pkg)
    const out = await client.generatePackagesNumbers(body)
    return out.kind === "refused" ? out.problems.map((x) => `${x.code}/${x.source ?? ""}`) : [out.kind]
  }
  assert.deepEqual(await refused((pkg) => void pkg.parcels.push({ ...pkg.parcels[0] })), ["multi_box_not_allowed/dpd"])
  assert.deepEqual(await refused((pkg) => void (pkg.parcels[0].weight = 25)), ["pickup_over_limit/dpd"])
  assert.deepEqual(await refused((pkg) => { if (pkg.pudoReceiver) Object.assign(pkg.pudoReceiver, { phone: undefined, email: undefined }) }), ["contact_missing/dpd"])
  assert.deepEqual(await refused((pkg) => { for (const a of pkg.services?.[0]?.attributes ?? []) a.value = "PL14509" }), ["pudo_not_found/dpd"])
  assert.deepEqual(await refused(() => {}), ["ok"])
})

/* Stage 4: the handover in demo mode, simulated end to end (O18). */

function demoHandover(n: number) {
  const s = setup({ demo: true }, [])
  arm(s, "shipment")
  arm(s, "pickup")
  const rows = Array.from({ length: n }, (_, i) => insertLabeled(s, labeledOrder(i + 1)))
  return { s, ids: rows.map((r) => String(r.id)), fulfillments: rows.map((r) => String(r.fulfillment_id)) }
}

const markerWrites = (updates: Array<{ data: Row }>) =>
  updates.filter((u) => {
    const data = (u.data.data ?? {}) as Row
    return "dpd_handed_over_at" in data || "dpd_dispatch_id" in data
  })

test("demo handover: plan, print, order and cancel with zero fetch; sample protocol stored", async () => {
  const { s, ids } = demoHandover(2)
  const { plan } = await planDispatch(s.container, ids)
  assert.ok(plan.ok, JSON.stringify(plan.problems))
  const view = await createDispatch(s.container, { shipmentIds: ids, planHash: plan.hash, print: true }, { actor: "user_01ADMIN" })
  assert.equal(view.dispatch.state, "printed", String(view.dispatch.error))
  const doc = s.documents.rows.find((d) => d.type === "protocol")
  assert.ok(doc)
  assert.ok(Buffer.from(String(doc.data), "base64").toString("latin1").startsWith("%PDF"), "a sample PDF is stored")
  const window = { pickupDate: courierDays(new Date())[1], pickupTimeFrom: "10:00", pickupTimeTo: "13:00" }
  const ordered = await orderCourier(s.container, view.dispatch.id, window, { actor: "user_01ADMIN" })
  assert.equal(ordered.dispatch.state, "ordered", String(ordered.dispatch.error))
  assert.ok(ordered.dispatch.order_number)
  const canceled = await cancelCourier(s.container, view.dispatch.id, { actor: "user_01ADMIN" })
  assert.equal(canceled.dispatch.state, "printed")
})

test("demo never writes or clears the handover marker, also on a real fulfillment", async () => {
  const { s, ids, fulfillments } = demoHandover(2)
  const { plan } = await planDispatch(s.container, ids)
  const view = await createDispatch(s.container, { shipmentIds: ids, planHash: plan.hash, print: true }, { actor: "user_01ADMIN" })
  assert.equal(view.dispatch.state, "printed")
  await withdrawShipment(s.container, ids[0], { actor: "user_01ADMIN" })
  await cancelDispatch(s.container, view.dispatch.id, { actor: "user_01ADMIN" })

  const { plan: again } = await planDispatch(s.container, [ids[0]])
  const second = await createDispatch(s.container, { shipmentIds: [ids[0]], planHash: again.hash }, { actor: "user_01ADMIN" })
  const row = s.dispatches.rows.find((r) => r.id === second.dispatch.id)
  assert.ok(row)
  Object.assign(row, { state: "printing", claim_token: "old", lease_until: new Date(Date.now() - PROTOCOL_LEASE_MS), error_code: "protocol_unclear" })
  assert.equal(await expireDispatches(s.container, "demo", new Date()), 1)

  assert.deepEqual(markerWrites(s.fulfillmentUpdates), [], "no marker write and no marker clearing in demo")
  const provider = new DpdFulfillmentProvider({ logger: { info: () => {}, warn: () => {}, error: () => {} } }, { demo: true })
  for (const f of fulfillments) assert.deepEqual(await provider.cancelFulfillment(s.fulfillments.get(f)?.data ?? {}), {})
})

/* Stage 5: statuses in demo (DS8, O4). */

test("resetDemo removes demo:status keys and keeps those of the other modes", async () => {
  const s = setup({ demo: true }, orders(2))
  await ensureDemoSeed(s.container)
  for (const name of ["lastSyncAt", "problem", "prunedAt"]) {
    s.settings.insert({ key: `demo:status:${name}`, value: { at: "2026-11-03T10:00:00.000Z" }, updated_by: null })
    s.settings.insert({ key: `live:status:${name}`, value: { at: "2026-11-03T10:00:00.000Z" }, updated_by: null })
  }
  const removed = await resetDemo(s.container)
  assert.equal(removed.settings, 4, "demo:seeded and the three demo:status keys")
  assert.deepEqual(s.settings.rows.map((r) => r.key).sort(), ["live:status:lastSyncAt", "live:status:problem", "live:status:prunedAt"])
})

test("the header of demo.ts keeps the seed rule and says where the statuses of demo come from (O4)", () => {
  const text = readFileSync(new URL("../src/modules/dpd/lib/demo.ts", import.meta.url), "utf8")
  assert.match(text, /No InfoServices event code is invented either: the rows carry a stage\n \* \(where the parcel is\) and no status code\./)
  assert.match(text, /The seed rows never move: the status pass skips demo rows without a\n \* fulfillment\. Shipments made in demo get their statuses from the status\n \* simulator \(status-sim\.ts\), whose codes come from the DPD documentation or\n \* the libraries it cites, plus SIM_ codes only the built in map knows\./)
})
