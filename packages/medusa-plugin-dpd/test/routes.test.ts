/**
 * The shipment routes of stage 2 as the admin calls them: every answer
 * about one shipment is private and no-store, the plan carries the receiver
 * read live and its hash, the create and the label answer the row, the
 * stored label is served as PDF bytes with its file name (in demo mode a
 * sample is built when none is stored), the actions of each state, the
 * refusals with their codes, and the write guard of the middlewares over
 * the new routes. Fake DPDServices, memory store, no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ActionResponse, ErrorResponse, PlanResponse, ShipmentResponse } from "../src/modules/dpd/lib/contract.ts"
import { ACTION_ERROR_CODES } from "../src/modules/dpd/lib/contract.ts"
import { shipmentActions } from "../src/modules/dpd/lib/dto.ts"
import { SHIPMENT_STATES } from "../src/modules/dpd/lib/constants.ts"
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
import { FakeDpdServices, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"
import { arm, order, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

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
  for (const code of ["writer_off", "not_armed", "not_configured", "plan_hash_missing", "plan_changed", "plan_problems", "too_early", "wrong_state", "no_label", "busy"]) {
    assert.ok((ACTION_ERROR_CODES as readonly string[]).includes(code), code)
  }
})

test("the actions of every state: what the buttons of the admin may offer", () => {
  const W = ["0000899000001Q"]
  const on = (state: string, waybills: string[] | null = null, kind = "outbound") =>
    Object.entries(shipmentActions({ state: state as never, kind: kind as never, waybills }))
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
  assert.deepEqual(on("pending"), ["boxes", "create", "plan", "skip"])
  assert.deepEqual(on("failed"), ["boxes", "create", "plan", "skip"])
  assert.deepEqual(on("pending", null, "return"), ["boxes", "skip"])
  assert.deepEqual(on("created", W), ["fetchLabel"])
  assert.deepEqual(on("labeled", W), ["label"])
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
