/**
 * The shipment routes of stage 2 as the admin calls them: every answer
 * about one shipment is private and no-store, the plan carries the receiver
 * read live and its hash, the create and the label answer the row, the
 * stored label is served as PDF bytes with its file name (in demo mode a
 * sample is built when none is stored), the actions of each state, the
 * refusals with their codes, and the write guard of the middlewares over
 * the new routes. Stage 3: the point search of the admin, a point of the
 * store, the Pickup plan with its point, the point change and pickupCheck.
 * Fake DPDServices, the catalog of the mode, memory store, no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ActionResponse, ErrorResponse, PlanResponse, PointResponse, PointsResponse, ShipmentResponse } from "../src/modules/dpd/lib/contract.ts"
import { ACTION_ERROR_CODES } from "../src/modules/dpd/lib/contract.ts"
import { countsOf, shipmentActions } from "../src/modules/dpd/lib/dto.ts"
import { SHIPMENT_STATES } from "../src/modules/dpd/lib/constants.ts"
import { resolveOptions } from "../src/modules/dpd/lib/options.ts"
import { optionsSummary } from "../src/api/admin/dpd/helpers.ts"
import { recordFulfillment } from "../src/workflows/dpd/shipments.ts"
import middlewares from "../src/api/middlewares.ts"
import { GET as getShipment } from "../src/api/admin/dpd/shipments/[id]/route.ts"
import { GET as getPlan } from "../src/api/admin/dpd/shipments/[id]/plan/route.ts"
import { POST as postCreate } from "../src/api/admin/dpd/shipments/[id]/create/route.ts"
import { GET as getLabel, POST as postLabel } from "../src/api/admin/dpd/shipments/[id]/label/route.ts"
import { POST as postLookup } from "../src/api/admin/dpd/shipments/[id]/lookup/route.ts"
import { POST as postSkip } from "../src/api/admin/dpd/shipments/[id]/skip/route.ts"
import { POST as postAccept } from "../src/api/admin/dpd/shipments/[id]/accept/route.ts"
import { POST as postBoxes } from "../src/api/admin/dpd/shipments/[id]/boxes/route.ts"
import { POST as postPoint } from "../src/api/admin/dpd/shipments/[id]/point/route.ts"
import { GET as getAdminPoints } from "../src/api/admin/dpd/points/route.ts"
import { GET as getStorePoint } from "../src/api/store/dpd/points/[id]/route.ts"
import { FakeDpdServices, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"
import { GET as getStatus } from "../src/api/admin/dpd/route.ts"
import { GET as getShipments } from "../src/api/admin/dpd/shipments/route.ts"
import { GET as getOrderCard } from "../src/api/admin/dpd/orders/[orderId]/route.ts"
import type { OrderDpdResponse, ShipmentsResponse, StatusResponse } from "../src/modules/dpd/lib/contract.ts"
import { createDispatch, planDispatch } from "../src/workflows/dpd/dispatch.ts"
import { arm, insertLabeled, labeledOrder, order, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in the tests")
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "only the fake DPDServices is ever called")
})

const ORDER = "order_01KODA0000000000000000001"
const FUL = "ful_01KODA0000000000000000001"
const COURIER = { dpd_option: "dpd-courier", dpd_kind: "courier", dpd_cod: false, dpd_country: "PL" }

type Answer<T> = { status: number; body: T; headers: Record<string, string> }

async function call<T>(handler: (req: never, res: never) => Promise<void>, s: Setup, id: string, req: Row = {}): Promise<Answer<T>> {
  const out: Answer<unknown> = { status: 200, body: undefined, headers: {} }
  const res = {
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value
      return res
    },
    status(code: number) {
      out.status = code
      return res
    },
    json(body: unknown) {
      out.body = body
      return res
    },
    send(body: unknown) {
      out.body = body
      return res
    },
  }
  await handler({ scope: s.container, query: {}, params: { id }, body: {}, headers: {}, auth_context: { actor_id: "user_01ADMIN" }, ...req } as never, res as never)
  return out as Answer<T>
}

function courierOrder(items: Row[] = [{ id: "li_1", quantity: 2, variant: { weight: 1200 } }]): Row {
  return order({ id: ORDER, items, fulfillments: [{ id: FUL, provider_id: "dpd_dpd", data: COURIER, canceled_at: null }] })
}

async function ready(options: Row = { ...SANDBOX, shipmentWriter: true }, orders: Row[] = [courierOrder()]) {
  const fake = new FakeDpdServices()
  const s = setup(options as never, orders, { fake })
  arm(s, "shipment")
  const row = await recordFulfillment(s.container, ORDER, FUL)
  return { s, fake, id: String(row?.id) }
}

test("GET plan: the receiver read live, the boxes, the hash; private, no-store; nothing stored, nothing sent", async () => {
  const { s, fake, id } = await ready()
  const before = JSON.stringify(s.shipments.rows)
  const plan = await call<PlanResponse>(getPlan, s, id)
  assert.equal(plan.status, 200)
  assert.equal(plan.headers["cache-control"], "private, no-store")
  assert.equal(plan.body.plan.ok, true)
  assert.equal(plan.body.plan.receiver?.city, "Warszawa")
  assert.equal(plan.body.plan.weightKg, 2.4)
  assert.equal(plan.body.plan.reference, FUL)
  assert.match(plan.body.plan.hash, /^[0-9a-f]{16,}$/)
  assert.equal(plan.body.writerArmed, true)
  assert.equal(plan.body.mode, "sandbox")
  assert.equal(plan.body.labelPage, "A4")
  assert.equal(plan.body.shipment.actions.create, true)
  assert.equal(JSON.stringify(s.shipments.rows), before, "reading a plan writes nothing")
  assert.equal(fake.calls.length, 0)

  assert.equal((await call<ErrorResponse>(getPlan, s, "bad id!")).status, 400)
  const missing = await call<ErrorResponse>(getPlan, s, "dpdshp_none")
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, "not_found")
  assert.equal(missing.headers["cache-control"], "private, no-store", "a refusal is no-store too")
})

test("POST create, then GET shipment and GET label: the row, its documents without bytes, the PDF with its file name", async () => {
  const { s, fake, id } = await ready()
  const noHash = await call<ErrorResponse>(postCreate, s, id, { body: {} })
  assert.equal(noHash.status, 400)
  assert.equal(noHash.body.code, "plan_hash_missing")
  assert.equal((await call<ErrorResponse>(postCreate, s, id, { body: { planHash: "x", page: "A5" } })).body.code, "invalid")
  const { body: plan } = await call<PlanResponse>(getPlan, s, id)
  const created = await call<ActionResponse>(postCreate, s, id, { body: { planHash: plan.plan.hash, page: "LBL_PRINTER" } })
  assert.equal(created.status, 200)
  assert.equal(created.headers["cache-control"], "private, no-store")
  assert.equal(created.body.shipment.state, "labeled")
  assert.equal(created.body.shipment.actions.label, true)
  assert.equal(created.body.shipment.actions.create, false)
  assert.equal(fake.count("numbers"), 1)

  const one = await call<ShipmentResponse>(getShipment, s, id)
  assert.equal(one.headers["cache-control"], "private, no-store")
  assert.equal(one.body.documents.length, 1)
  assert.equal(one.body.documents[0].page, "LBL_PRINTER")
  assert.ok(!JSON.stringify(one.body).includes(TINY_PDF_BASE64), "never the bytes in JSON")
  assert.ok(one.body.events.length >= 3)
  assert.equal(one.body.writerArmed, true)

  const pdf = await call<Buffer>(getLabel, s, id, { query: { download: "1" } })
  assert.equal(pdf.status, 200)
  assert.equal(pdf.headers["content-type"], "application/pdf")
  assert.equal(pdf.headers["cache-control"], "private, no-store")
  assert.match(pdf.headers["content-disposition"], /^attachment; filename="[^"]*1042[^"]*\.pdf"$/)
  assert.ok(Buffer.isBuffer(pdf.body))
  assert.equal(pdf.body.toString("base64"), TINY_PDF_BASE64, "the stored bytes, as DPD sent them")
  assert.match((await call<Buffer>(getLabel, s, id)).headers["content-disposition"], /^inline; /)
  assert.equal(fake.count("labels"), 1, "opening the label again asks DPD for nothing")
})

test("POST label for a created row; GET label 404 no_label without one outside demo mode; demo builds a sample", async () => {
  const { s, fake, id } = await ready()
  fake.failNext("labels", "timeout")
  const { body: plan } = await call<PlanResponse>(getPlan, s, id)
  const created = await call<ActionResponse>(postCreate, s, id, { body: { planHash: plan.plan.hash } })
  assert.equal(created.body.shipment.state, "created")
  assert.equal(created.body.shipment.actions.fetchLabel, true)
  const none = await call<ErrorResponse>(getLabel, s, id)
  assert.equal(none.status, 404)
  assert.equal(none.body.code, "no_label")
  const labeled = await call<ActionResponse>(postLabel, s, id, { body: { page: "A4" } })
  assert.equal(labeled.body.shipment.state, "labeled")
  assert.equal((await call<ErrorResponse>(postLabel, s, id)).body.code, "wrong_state")

  const demo = setup({ demo: true }, [])
  const row = await demo.store.insertIgnore({
    order_id: "order_demo",
    display_id: 7,
    fulfillment_id: null,
    return_id: null,
    kind: "outbound",
    mode: "demo",
    option_id: "dpd-courier",
    service: "courier",
    pudo_id: null,
    country_code: "PL",
    session_type: "DOMESTIC",
    cod_minor: 12345,
    currency: "PLN",
    reference: null,
    state: "pending",
    problems: null,
  })
  await demo.store.transition(String(row?.id), ["pending"], { state: "labeled", waybills: ["99000000000017D"] })
  const sample = await call<Buffer>(getLabel, demo, String(row?.id))
  assert.equal(sample.status, 200)
  assert.equal(sample.body.subarray(0, 5).toString("latin1"), "%PDF-")
  assert.equal(demo.documents.rows.length, 0, "a sample is never stored")
})

test("POST boxes: by hand, back to automatic with null, refused when invalid or not waiting; the plan follows", async () => {
  const { s, id } = await ready(undefined, [courierOrder([])])
  const before = await call<PlanResponse>(getPlan, s, id)
  assert.equal(before.body.plan.ok, false)
  assert.deepEqual(before.body.plan.problems.map((p) => p.code), ["weight_missing"])
  const set = await call<PlanResponse>(postBoxes, s, id, { body: { boxes: [{ weightKg: 3.5, lengthCm: 40, widthCm: 30, heightCm: 20 }, { weightKg: "1,5" }] } })
  assert.equal(set.status, 200)
  assert.equal(set.headers["cache-control"], "private, no-store")
  assert.equal(set.body.plan.ok, true)
  assert.equal(set.body.plan.boxesSource, "edited")
  assert.equal(set.body.plan.boxes.length, 2)
  assert.deepEqual(set.body.shipment.problems, [])
  assert.equal(s.shipments.rows.find((r) => r.id === id)?.problems, null, "a clean plan clears the stored problems")
  assert.ok(s.events.rows.some((e) => (e.data as Row | null)?.action === "boxes_changed"))
  const invalid = await call<ErrorResponse>(postBoxes, s, id, { body: { boxes: [{ weightKg: 0 }] } })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, "invalid")
  assert.deepEqual(invalid.body.fields, [{ index: 0, field: "weightKg" }])
  const sides = await call<ErrorResponse>(postBoxes, s, id, { body: { boxes: [{ weightKg: 1 }, { weightKg: 2, widthCm: 900 }] } })
  assert.deepEqual(sides.body.fields, [{ index: 1, field: "widthCm" }], "the 0-based box and the BoxDto field name")
  const missing = await call<ErrorResponse>(postBoxes, s, id, { body: {} })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.fields, undefined, "no box to point at")
  const back = await call<PlanResponse>(postBoxes, s, id, { body: { boxes: null } })
  assert.equal(back.body.plan.boxesSource, "none")
  s.shipments.rows.find((r) => r.id === id)!.state = "labeled"
  assert.equal((await call<ErrorResponse>(postBoxes, s, id, { body: { boxes: null } })).body.code, "wrong_state")
})

test("POST lookup, skip and accept answer the row or their refusal; the writer refusals carry their codes", async () => {
  const { s, fake, id } = await ready()
  fake.failNext("numbers", "timeout")
  const { body: plan } = await call<PlanResponse>(getPlan, s, id)
  const unknown = await call<ActionResponse>(postCreate, s, id, { body: { planHash: plan.plan.hash } })
  assert.equal(unknown.body.shipment.state, "unknown")
  assert.equal(unknown.body.shipment.actions.lookup, true)
  assert.equal(unknown.body.shipment.actions.skip, false)
  const early = await call<ErrorResponse>(postLookup, s, id)
  assert.equal(early.status, 409)
  assert.equal(early.body.code, "too_early")
  assert.equal(early.headers["cache-control"], "private, no-store")
  s.shipments.rows.find((r) => r.id === id)!.updated_at = new Date(Date.now() - 10 * 60_000)
  const looked = await call<ActionResponse>(postLookup, s, id)
  assert.equal(looked.body.shipment.state, "pending", "DPD has nothing: created again later")
  assert.equal((await call<ErrorResponse>(postAccept, s, id)).body.code, "wrong_state")
  const skipped = await call<ActionResponse>(postSkip, s, id)
  assert.equal(skipped.body.shipment.state, "skipped")
  assert.equal((await call<ErrorResponse>(postSkip, s, id)).body.code, "wrong_state")

  const off = await ready({ ...SANDBOX })
  const { body: offPlan } = await call<PlanResponse>(getPlan, off.s, off.id)
  assert.equal(offPlan.writerArmed, false, "a writer the options turn off is never armed")
  const refused = await call<ErrorResponse>(postCreate, off.s, off.id, { body: { planHash: offPlan.plan.hash } })
  assert.equal(refused.status, 409)
  assert.equal(refused.body.code, "writer_off")
  for (const code of ["writer_off", "not_armed", "not_configured", "plan_hash_missing", "plan_changed", "plan_problems", "too_early", "wrong_state", "no_label", "busy", "already_shipped", "statuses_auth", "status_unavailable"]) {
    assert.ok((ACTION_ERROR_CODES as readonly string[]).includes(code), code)
  }
})

test("the actions of every state: what the buttons of the admin may offer", () => {
  const W = ["0000899000001Q"]
  type Extra = {
    dispatch_id?: string | null
    handed_over_at?: Date | null
    session_type?: string | null
    stage?: string | null
    shipped_marked_at?: Date | null
    mode?: string
    fulfillment_id?: string | null
    status_writer_error?: string | null
    tracking?: unknown
  }
  const on = (state: string, waybills: string[] | null = null, kind = "outbound", extra: Extra = {}) =>
    Object.entries(
      shipmentActions({
        state: state as never,
        kind: kind as never,
        waybills,
        dispatch_id: null,
        handed_over_at: null,
        session_type: null,
        stage: null,
        shipped_marked_at: null,
        mode: "sandbox",
        fulfillment_id: "ful_1",
        ...extra,
      }),
    )
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
  assert.deepEqual(on("pending"), ["boxes", "create", "plan", "skip"])
  assert.deepEqual(on("failed"), ["boxes", "create", "plan", "skip"])
  assert.deepEqual(on("pending", null, "return"), ["boxes", "skip"])
  assert.deepEqual(on("created", W), ["exclude", "fetchLabel", "refreshStatus"])
  assert.deepEqual(on("labeled", W), ["dispatch", "exclude", "label", "refreshStatus"])
  assert.deepEqual(on("excluded"), ["restore"])
  assert.deepEqual(on("labeled", W, "outbound", { dispatch_id: "dpddsp_01" }), ["label", "refreshStatus", "withdraw"], "in a dispatch: withdraw, never exclude or dispatch")
  assert.deepEqual(on("labeled", W, "outbound", { handed_over_at: new Date() }), ["label", "refreshStatus"], "handed over without a dispatch: neither exclude nor dispatch")
  assert.deepEqual(on("labeled", W, "return"), ["label"], "a return is never excluded or dispatched")
  assert.deepEqual(on("labeled", W, "outbound", { session_type: "INTERNATIONAL" }), ["exclude", "label", "refreshStatus"], "an international shipment is not a candidate")
  /* Stage 5: statuses, and nothing withdrawn once DPD has the parcel (DS13, E25, E28). */
  assert.deepEqual(on("labeled", W, "outbound", { status_writer_error: "boom" }), ["dispatch", "exclude", "label", "refreshStatus", "retryStatusWriter"])
  assert.deepEqual(on("labeled", W, "outbound", { stage: "in_transit" }), ["label", "refreshStatus"], "in transit: no exclude, no new handover (E54)")
  assert.deepEqual(on("labeled", W, "outbound", { stage: "in_transit", dispatch_id: "dpddsp_01" }), ["label", "refreshStatus"], "in transit: no withdraw")
  const before = [{ waybill: W[0], box: 0, role: "outbound", stage: "problem", code: "040201", at: null, possession: false, lastCode: "040201", lastAt: null, description: null, supersededBy: null, supersededAt: null, from: null, checkedAt: null, done: false }]
  assert.deepEqual(on("labeled", W, "outbound", { stage: "problem", dispatch_id: "dpddsp_01", tracking: before }), ["label", "refreshStatus", "withdraw"], "a failed pickup without possession still withdraws")
  assert.deepEqual(on("labeled", W, "outbound", { stage: "problem", tracking: before }), ["dispatch", "exclude", "label", "refreshStatus"], "a failed pickup without possession still excludes")
  const held = [{ ...before[0], code: "160102", lastCode: "160102", possession: true }]
  assert.deepEqual(on("labeled", W, "outbound", { stage: "problem", dispatch_id: "dpddsp_01", tracking: held }), ["label", "refreshStatus"], "a problem with possession: no withdraw")
  assert.deepEqual(on("labeled", W, "outbound", { stage: "problem", tracking: held }), ["label", "refreshStatus"], "a problem with possession: no exclude, no new handover")
  assert.deepEqual(on("labeled", W, "outbound", { stage: null, tracking: held }), ["label", "refreshStatus"], "possession before any stage: no new handover")
  assert.deepEqual(on("labeled", W, "outbound", { shipped_marked_at: new Date() }), ["label", "refreshStatus"], "marked shipped by the plugin: no new handover")
  for (const stage of ["in_point", "delivered", "returned"]) assert.ok(!on("labeled", W, "outbound", { stage }).includes("dispatch"), stage)
  assert.deepEqual(on("labeled", W, "outbound", { mode: "demo", fulfillment_id: null }), ["dispatch", "exclude", "label"], "a sample demo row never refreshes")
  assert.deepEqual(on("labeled", W, "outbound", { stage: "canceled" }), ["dispatch", "exclude", "label"], "a canceled stage never refreshes")
  assert.deepEqual(on("unknown"), ["lookup"])
  assert.deepEqual(on("abandoned_unknown"), ["lookup"])
  assert.deepEqual(on("abandoned_unknown", W), ["label"])
  assert.deepEqual(on("ambiguous", W), ["accept", "label", "skip"])
  assert.deepEqual(on("ambiguous"), ["skip"])
  for (const state of ["creating", "labeling", "skipped", "canceled"]) assert.deepEqual(on(state, W), [], state)
  for (const state of SHIPMENT_STATES) assert.ok(Array.isArray(on(state)), state)
})

test("the write guard of /admin/dpd* covers the shipment routes: a form post is 415, JSON goes through", () => {
  const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Array<(req: never, res: never, next: () => void) => void> }> }).routes
  const admin = routes.find((r) => r.matcher === "/admin/dpd*")
  assert.ok(admin)
  for (const path of ["create", "label", "lookup", "skip", "accept", "boxes"]) {
    const out = { status: 0, next: false }
    const res = { status: (c: number) => ((out.status = c), res), json: () => res }
    admin.middlewares[0]({ method: "POST", url: `/admin/dpd/shipments/dpdshp_1/${path}`, headers: { "content-type": "text/plain" } } as never, res as never, () => void (out.next = true))
    assert.equal(out.status, 415, path)
    const ok = { next: false }
    admin.middlewares[0]({ method: "POST", url: `/admin/dpd/shipments/dpdshp_1/${path}`, headers: { "content-type": "application/json" } } as never, res as never, () => void (ok.next = true))
    assert.equal(ok.next, true, path)
  }
})

/* Stage 3: the point routes and the Pickup plan (spec 6, 9). */

const PICKUP = { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL14509", dpd_country: "PL" }

function pickupOrder(pudoId: string | null = "PL14509"): Row {
  const data = { ...PICKUP, dpd_pudo_id: pudoId }
  return order({
    id: ORDER,
    items: [{ id: "li_1", quantity: 1, variant: { weight: 1500 } }],
    shipping_methods: [{ id: "sm_01", name: "DPD Pickup", shipping_option_id: "so_01", data }],
    fulfillments: [{ id: FUL, provider_id: "dpd_dpd", data, canceled_at: null }],
  })
}

test("GET /admin/dpd/points: the points of the mode and their source, private, no-store; a bad query 400", async () => {
  const s = setup(SANDBOX)
  const found = await call<PointsResponse>(getAdminPoints, s, "", { query: { zip: "02-495" } })
  assert.equal(found.status, 200)
  assert.equal(found.headers["cache-control"], "private, no-store")
  assert.equal(found.body.source, "sandbox")
  assert.deepEqual(found.body.points.map((p) => p.id), ["PL14509"], "only the points that hand out parcels")
  const bad = await call<ErrorResponse>(getAdminPoints, s, "", { query: { zip: "02-495", lat: "52" } })
  assert.equal(bad.status, 400)
  assert.equal(bad.headers["cache-control"], "private, no-store")
})

test("GET /store/dpd/points/:id: a point outside the catalog is 404 point_not_found, cached like a point", async () => {
  const s = setup(SANDBOX)
  const hit = await call<PointResponse>(getStorePoint, s, "pl14509")
  assert.equal(hit.status, 200)
  assert.equal(hit.body.point.id, "PL14509")
  const miss = await call<ErrorResponse>(getStorePoint, s, "PL0SBX99")
  assert.equal(miss.status, 404)
  assert.equal(miss.body.code, "point_not_found")
  assert.equal(miss.headers["cache-control"], "public, max-age=300")
})

test("the Pickup plan carries the point with its check and the recipient of the point; a missing and a wrong id are problems", async () => {
  const { s, id } = await ready({ ...SANDBOX, shipmentWriter: true }, [pickupOrder()])
  const plan = await call<PlanResponse>(getPlan, s, id)
  assert.equal(plan.status, 200)
  assert.equal(plan.body.plan.ok, true)
  assert.equal(plan.body.plan.point?.pudoId, "PL14509")
  assert.equal(plan.body.plan.point?.check, "ok")
  assert.equal(plan.body.plan.point?.point?.name, "DPD Pickup, Oddział Miejski")
  assert.equal(plan.body.plan.point?.reason, null)
  assert.equal(plan.body.plan.point?.source, "sandbox")
  assert.ok(plan.body.plan.pudoReceiver, "the recipient of the point")
  assert.equal(plan.body.plan.receiver, null, "a Pickup shipment has no courier address")

  const none = await ready({ ...SANDBOX, shipmentWriter: true }, [pickupOrder(null)])
  const missing = await call<PlanResponse>(getPlan, none.s, none.id)
  assert.deepEqual(missing.body.plan.problems.map((p) => p.code), ["pudo_missing"])
  assert.equal(missing.body.plan.point?.check, "missing")

  const wrong = await ready({ ...SANDBOX, shipmentWriter: true }, [pickupOrder()])
  const row = wrong.s.shipments.rows.find((r) => r.id === wrong.id)
  assert.ok(row)
  row.pudo_id = "14509"
  const invalid = await call<PlanResponse>(getPlan, wrong.s, wrong.id)
  assert.deepEqual(invalid.body.plan.problems.map((p) => p.code), ["pudo_invalid"])
  assert.equal(invalid.body.plan.point?.check, "invalid", "a wrong id is never read")
  assert.equal(invalid.body.plan.point?.point, null)
})

test("POST point through the route: the new plan, the write guard 415 on a form post", async () => {
  const { s, id } = await ready({ ...SANDBOX }, [pickupOrder()])
  const changed = await call<PlanResponse>(postPoint, s, id, { body: { pudoId: "PL14509" } })
  assert.equal(changed.status, 200, "the same point answers the plan")
  assert.equal(changed.body.shipment.pudoId, "PL14509")
  const refused = await call<ErrorResponse>(postPoint, s, id, { body: { pudoId: "PL0SBX01" } })
  assert.equal(refused.status, 422)
  assert.equal(refused.body.code, "point_refused")
  assert.deepEqual(refused.body.problems?.map((p) => p.code), ["pudo_inactive"])

  const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Array<(req: never, res: never, next: () => void) => void> }> }).routes
  const admin = routes.find((r) => r.matcher === "/admin/dpd*")
  assert.ok(admin)
  const out = { status: 0 }
  const res = { status: (c: number) => ((out.status = c), res), json: () => res }
  admin.middlewares[0]({ method: "POST", url: "/admin/dpd/shipments/dpdshp_1/point", headers: { "content-type": "text/plain" } } as never, res as never, () => {})
  assert.equal(out.status, 415)
})

test("pickupCheck of the status: the catalog outside live, MyPudo with its credentials, not_configured without them", () => {
  assert.equal(optionsSummary(resolveOptions(SANDBOX)).pickupCheck, "catalog")
  assert.equal(optionsSummary(resolveOptions({ ...SANDBOX, demo: true })).pickupCheck, "catalog")
  assert.equal(optionsSummary(resolveOptions({ ...SANDBOX, mode: "live" })).pickupCheck, "not_configured")
  assert.equal(optionsSummary(resolveOptions({ ...SANDBOX, mode: "live", pickupApiKey: "testkeykoda0000000000" })).pickupCheck, "mypudo")
  assert.equal(optionsSummary(resolveOptions({ ...SANDBOX, mode: "live", pickupLogin: "test", pickupPassword: "test-password-koda-0000" })).pickupCheck, "mypudo")
})

/* Stage 4: the counts and the order card with dispatches (10.11). */

test("counts carry dispatches and dispatchesAttention", async () => {
  const counts = countsOf([{ group: "labeled", count: 3 }], { open: 2, attention: 1 })
  assert.equal(counts.dispatches, 2)
  assert.equal(counts.dispatchesAttention, 1)
  const none = countsOf([{ group: "labeled", count: 3 }])
  assert.equal(none.dispatches, 0)
  assert.equal(none.dispatchesAttention, 0)

  const s = setup({ ...SANDBOX, shipmentWriter: true })
  arm(s, "shipment")
  const row = insertLabeled(s, labeledOrder(1))
  const { plan } = await planDispatch(s.container, [String(row.id)])
  const view = await createDispatch(s.container, { shipmentIds: [String(row.id)], planHash: plan.hash }, { actor: "user_01ADMIN" })
  const d = s.dispatches.rows.find((r) => r.id === view.dispatch.id)
  assert.ok(d)
  d.state = "unknown"
  const status = await call<StatusResponse>(getStatus, s, "")
  assert.equal(status.body.counts.dispatches, 1)
  assert.equal(status.body.counts.dispatchesAttention, 1)
  const list = await call<ShipmentsResponse>(getShipments, s, "")
  assert.equal(list.body.counts.dispatchesAttention, 1)
})

test("attention includes dispatchesAttention", () => {
  const without = countsOf([{ group: "problems", count: 2 }, { group: "to_create", count: 1 }])
  const withAttention = countsOf([{ group: "problems", count: 2 }, { group: "to_create", count: 1 }], { open: 4, attention: 2 })
  assert.equal(withAttention.attention, without.attention + 2)
})

test("options summary has courierOrders per mode", () => {
  assert.equal(optionsSummary(resolveOptions({ demo: true })).courierOrders, "demo")
  assert.equal(optionsSummary(resolveOptions(SANDBOX)).courierOrders, "simulated")
  assert.equal(optionsSummary(resolveOptions({ ...SANDBOX, mode: "live" })).courierOrders, "dpd")
})

test("order card lists the dispatches of its shipments", async () => {
  const s = setup({ ...SANDBOX, shipmentWriter: true })
  arm(s, "shipment")
  const labeled = labeledOrder(1)
  const row = insertLabeled(s, labeled)
  const free = await call<OrderDpdResponse>(getOrderCard, s, "", { params: { orderId: labeled.order.id } })
  assert.deepEqual(free.body.dispatches, [])
  const { plan } = await planDispatch(s.container, [String(row.id)])
  const view = await createDispatch(s.container, { shipmentIds: [String(row.id)], planHash: plan.hash }, { actor: "user_01ADMIN" })
  const card = await call<OrderDpdResponse>(getOrderCard, s, "", { params: { orderId: labeled.order.id } })
  assert.equal(card.status, 200)
  assert.deepEqual(card.body.dispatches.map((d) => d.id), [view.dispatch.id])
  assert.deepEqual(card.body.dispatches[0]?.shipmentIds, [row.id])
})
