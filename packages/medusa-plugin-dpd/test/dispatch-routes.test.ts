/**
 * The routes of the handover (stage 4, spec 10 and 13.1a) as the admin calls
 * them: the shape of every answer, private and no-store, the write guard,
 * the 400s of a malformed body or query, 404 for a dispatch of another mode,
 * 409 busy while claimed, Retry-After when the pacing held the availability
 * back, the protocol PDF with its file name and only from the protocols
 * column. Fake DPDServices (live, so the courier goes to the fake), memory
 * store, no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type {
  ActionResponse,
  AvailabilityResponse,
  DispatchesResponse,
  DispatchPlanResponse,
  DispatchResponse,
  ErrorResponse,
  WithdrawResponse,
} from "../src/modules/dpd/lib/contract.ts"
import { courierDays } from "../src/modules/dpd/lib/courier.ts"
import type { DpdPluginOptions } from "../src/modules/dpd/lib/options.ts"
import { courierAvailability } from "../src/workflows/dpd/dispatch.ts"
import middlewares from "../src/api/middlewares.ts"
import { GET as getDispatches, POST as postDispatches } from "../src/api/admin/dpd/dispatches/route.ts"
import { POST as postPlan } from "../src/api/admin/dpd/dispatch-plan/route.ts"
import { POST as postGroupAvailability } from "../src/api/admin/dpd/courier-availability/route.ts"
import { GET as getDispatch } from "../src/api/admin/dpd/dispatches/[id]/route.ts"
import { POST as postPrint } from "../src/api/admin/dpd/dispatches/[id]/print/route.ts"
import { GET as getProtocol } from "../src/api/admin/dpd/dispatches/[id]/protocol/route.ts"
import { GET as getAvailability } from "../src/api/admin/dpd/dispatches/[id]/availability/route.ts"
import { POST as postOrder } from "../src/api/admin/dpd/dispatches/[id]/order/route.ts"
import { POST as postReschedule } from "../src/api/admin/dpd/dispatches/[id]/reschedule/route.ts"
import { POST as postCancelCourier } from "../src/api/admin/dpd/dispatches/[id]/cancel-courier/route.ts"
import { POST as postResolve } from "../src/api/admin/dpd/dispatches/[id]/resolve/route.ts"
import { POST as postCancel } from "../src/api/admin/dpd/dispatches/[id]/cancel/route.ts"
import { POST as postExclude } from "../src/api/admin/dpd/shipments/[id]/exclude/route.ts"
import { POST as postRestore } from "../src/api/admin/dpd/shipments/[id]/restore/route.ts"
import { POST as postWithdraw } from "../src/api/admin/dpd/shipments/[id]/withdraw/route.ts"
import { FakeDpdServices, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"
import { arm, insertLabeled, labeledOrder, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

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

const LIVE: DpdPluginOptions = { ...SANDBOX, mode: "live", shipmentWriter: true, pickupWriter: true }

type Answer<T> = { status: number; body: T; headers: Record<string, string> }

async function call<T>(handler: (req: never, res: never) => Promise<void>, s: Setup, req: Row = {}): Promise<Answer<T>> {
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
  await handler({ scope: s.container, query: {}, params: {}, body: {}, headers: {}, auth_context: { actor_id: "user_01ADMIN" }, ...req } as never, res as never)
  return out as Answer<T>
}

type World = { s: Setup; fake: FakeDpdServices; ids: string[] }

function world(n = 2, extra: { requestsPerMinute?: number; options?: DpdPluginOptions } = {}): World {
  const fake = new FakeDpdServices({ courier: "works" })
  const s = setup(extra.options ?? LIVE, [], { fake, requestsPerMinute: extra.requestsPerMinute })
  arm(s, "shipment")
  arm(s, "pickup")
  const ids = Array.from({ length: n }, (_, i) => String(insertLabeled(s, labeledOrder(i + 1)).id))
  return { s, fake, ids }
}

async function createdVia(w: World, print = false): Promise<DispatchResponse> {
  const plan = await call<DispatchPlanResponse>(postPlan, w.s, { body: { shipmentIds: w.ids } })
  assert.equal(plan.status, 200)
  const made = await call<DispatchResponse>(postDispatches, w.s, { body: { shipmentIds: w.ids, planHash: plan.body.plan.hash, print } })
  assert.equal(made.status, 200, JSON.stringify(made.body))
  return made.body
}

function windowBody(from = "10:00", to = "13:00") {
  return { pickupDate: courierDays(new Date())[1], pickupTimeFrom: from, pickupTimeTo: to }
}

function noStore(a: Answer<unknown>): void {
  assert.equal(a.headers["cache-control"], "private, no-store")
}

test("POST /admin/dpd/dispatch-plan and POST /admin/dpd/dispatches: the plan, its hash, the create with print", async () => {
  const w = world(2)
  const plan = await call<DispatchPlanResponse>(postPlan, w.s, { body: { shipmentIds: [...w.ids, w.ids[0]] } })
  noStore(plan)
  assert.equal(plan.body.mode, "live")
  assert.equal(plan.body.courierOrders, "dpd")
  assert.equal(plan.body.plan.ok, true)
  assert.equal(plan.body.plan.shipments.length, 2, "duplicates dropped")
  assert.ok(plan.body.writers.pickup)
  const empty = await call<DispatchPlanResponse>(postPlan, w.s, { body: { shipmentIds: [] } })
  assert.equal(empty.status, 200)
  assert.ok(empty.body.plan.problems.some((p) => p.code === "no_shipments"))
  for (const body of [{}, { shipmentIds: "x" }, { shipmentIds: ["bad id!"] }, { shipmentIds: Array.from({ length: 501 }, (_, i) => `s_${i}`) }]) {
    const bad = await call<ErrorResponse>(postPlan, w.s, { body })
    assert.equal(bad.status, 400, JSON.stringify(body).slice(0, 40))
    assert.equal(bad.body.code, "invalid")
    assert.ok(bad.body.fields?.[0]?.field === "shipmentIds")
  }

  const missing = await call<ErrorResponse>(postDispatches, w.s, { body: { shipmentIds: w.ids } })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, "plan_hash_missing")
  const badPrint = await call<ErrorResponse>(postDispatches, w.s, { body: { shipmentIds: w.ids, planHash: plan.body.plan.hash, print: "yes" } })
  assert.equal(badPrint.status, 400)
  assert.equal(badPrint.body.code, "invalid")
  const made = await call<DispatchResponse>(postDispatches, w.s, { body: { shipmentIds: w.ids, planHash: plan.body.plan.hash, print: true } })
  noStore(made)
  assert.equal(made.body.dispatch.state, "printed")
  assert.equal(made.body.dispatch.protocols.length, 1)
  assert.equal(made.body.courierOrders, "dpd")
  assert.ok(made.body.events.length >= 2)
  assert.ok(!JSON.stringify(made.body).includes("check_sum"))
})

test("GET /admin/dpd/dispatches: filters, counts, a bad filter 400; GET :id 404 for another mode", async () => {
  const w = world(2)
  const made = await createdVia(w)
  const list = await call<DispatchesResponse>(getDispatches, w.s)
  noStore(list)
  assert.equal(list.body.count, 1)
  assert.equal(list.body.open, 1)
  assert.equal(list.body.attention, 0)
  assert.deepEqual(list.body.dispatches[0]?.shipmentIds, w.ids)
  assert.equal(list.body.dispatches[0]?.shipments.length, 2)
  assert.deepEqual(list.body.dispatches[0]?.shipmentProblems, [])
  const attention = await call<DispatchesResponse>(getDispatches, w.s, { query: { filter: "attention" } })
  assert.equal(attention.body.count, 0)
  const bad = await call<ErrorResponse>(getDispatches, w.s, { query: { filter: "everything" } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, "invalid")

  const one = await call<DispatchResponse>(getDispatch, w.s, { params: { id: made.dispatch.id } })
  noStore(one)
  assert.equal(one.body.dispatch.id, made.dispatch.id)
  const other = w.s.dispatches.rows.find((r) => r.id === made.dispatch.id)
  assert.ok(other)
  other.mode = "sandbox"
  const gone = await call<ErrorResponse>(getDispatch, w.s, { params: { id: made.dispatch.id } })
  assert.equal(gone.status, 404)
  assert.equal(gone.body.code, "not_found")
  const malformed = await call<ErrorResponse>(getDispatch, w.s, { params: { id: "../x" } })
  assert.equal(malformed.status, 400)
  assert.equal(w.fake.calls.length, 0)
})

test("POST :id/print: busy while claimed, the protocol PDF with its name, only documents of the protocols column", async () => {
  const w = world(1)
  const made = await createdVia(w)
  const id = made.dispatch.id
  const row = w.s.dispatches.rows.find((r) => r.id === id)
  assert.ok(row)
  const none = await call<ErrorResponse>(getProtocol, w.s, { params: { id } })
  noStore(none)
  assert.equal(none.status, 404)
  assert.equal(none.body.code, "not_found")

  Object.assign(row, { state: "printing", claim_token: "t", lease_until: new Date(Date.now() + 60_000) })
  const busy = await call<ErrorResponse>(postPrint, w.s, { params: { id } })
  assert.equal(busy.status, 409)
  assert.equal(busy.body.code, "busy")
  Object.assign(row, { state: "pending", claim_token: null, lease_until: null })

  /* A document of this dispatch that never got into the column (a lost claim, E6). */
  w.s.documents.insert({ shipment_id: null, dispatch_id: id, type: "protocol", page: null, document_id: "999", data: TINY_PDF_BASE64, mode: "live", created_by: "system" })
  const orphan = w.s.documents.rows[w.s.documents.rows.length - 1]
  assert.equal((await call<ErrorResponse>(getProtocol, w.s, { params: { id } })).status, 404)
  assert.equal((await call<ErrorResponse>(getProtocol, w.s, { params: { id }, query: { document: orphan?.id } })).status, 404)

  const printed = await call<DispatchResponse>(postPrint, w.s, { params: { id } })
  assert.equal(printed.status, 200)
  assert.equal(printed.body.dispatch.state, "printed")
  const pdf = await call<Buffer>(getProtocol, w.s, { params: { id }, query: { download: "1" } })
  noStore(pdf)
  assert.equal(pdf.headers["content-type"], "application/pdf")
  const documentId = printed.body.dispatch.protocols[0]?.documentId
  assert.equal(pdf.headers["content-disposition"], `attachment; filename="dpd-protocol-${documentId}.pdf"`)
  assert.ok(Buffer.isBuffer(pdf.body))
  const inline = await call<Buffer>(getProtocol, w.s, { params: { id }, query: { document: printed.body.dispatch.protocols[0]?.id } })
  assert.match(inline.headers["content-disposition"] ?? "", /^inline;/)
  const badDoc = await call<ErrorResponse>(getProtocol, w.s, { params: { id }, query: { document: "x y" } })
  assert.equal(badDoc.status, 400)
  assert.equal(badDoc.body.code, "invalid")
  assert.equal(w.fake.count("protocol"), 1, "the PDF route never calls DPD")
})

test("courier routes: availability, order, reschedule, cancel-courier, resolve", async () => {
  const w = world(1)
  const made = await createdVia(w, true)
  const id = made.dispatch.id
  const avail = await call<AvailabilityResponse>(getAvailability, w.s, { params: { id } })
  noStore(avail)
  assert.equal(avail.status, 200)
  assert.equal(avail.body.countryCode, "PL")
  assert.equal(avail.body.days.length, 15)
  assert.equal(avail.body.simulated, false)
  assert.ok(avail.body.ranges.length > 0)

  const noKey = await call<ErrorResponse>(postOrder, w.s, { params: { id }, body: { pickupDate: "2026-12-01" } })
  assert.equal(noKey.status, 400)
  assert.deepEqual(noKey.body.fields?.map((f) => f.field), ["pickupTimeFrom", "pickupTimeTo"])
  const outside = await call<ErrorResponse>(postOrder, w.s, { params: { id }, body: windowBody("18:00", "19:00") })
  assert.equal(outside.status, 422)
  assert.equal(outside.body.code, "courier_window")
  assert.ok(outside.body.problems?.length)
  const order = await call<DispatchResponse>(postOrder, w.s, { params: { id }, body: windowBody() })
  noStore(order)
  assert.equal(order.body.dispatch.state, "ordered")
  assert.equal(order.body.dispatch.hasCheckSum, true)
  const twice = await call<ErrorResponse>(postOrder, w.s, { params: { id }, body: windowBody() })
  assert.equal(twice.status, 409)
  assert.equal(w.fake.count("pickupCreate"), 1)

  const moved = await call<DispatchResponse>(postReschedule, w.s, { params: { id }, body: windowBody("13:00", "16:00") })
  assert.equal(moved.body.dispatch.pickupTimeFrom, "13:00")
  const badOutcome = await call<ErrorResponse>(postResolve, w.s, { params: { id }, body: { outcome: "maybe" } })
  assert.equal(badOutcome.status, 400)
  assert.deepEqual(badOutcome.body.fields, [{ index: 0, field: "outcome" }])
  const notResolvable = await call<ErrorResponse>(postResolve, w.s, { params: { id }, body: { outcome: "ordered" } })
  assert.equal(notResolvable.status, 409)
  assert.equal(notResolvable.body.code, "wrong_state")
  const canceled = await call<DispatchResponse>(postCancelCourier, w.s, { params: { id } })
  assert.equal(canceled.body.dispatch.state, "printed")
  const noOrder = await call<ErrorResponse>(postCancelCourier, w.s, { params: { id } })
  assert.equal(noOrder.status, 409)
  assert.equal(noOrder.body.code, "wrong_state")
})

test("availability_unavailable from the pacing carries Retry-After; a group outside the plan is 404", async () => {
  const w = world(1, { requestsPerMinute: 1 })
  const made = await createdVia(w, true)
  const paced = await call<ErrorResponse>(getAvailability, w.s, { params: { id: made.dispatch.id } })
  assert.equal(paced.status, 503)
  assert.equal(paced.body.code, "availability_unavailable")
  assert.ok(Number(paced.headers["retry-after"]) > 0)

  const g = world(1)
  const unknown = await call<ErrorResponse>(postGroupAvailability, g.s, { body: { shipmentIds: g.ids, groupKey: "loc:nowhere" } })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.code, "not_found")
  const noKey = await call<ErrorResponse>(postGroupAvailability, g.s, { body: { shipmentIds: g.ids } })
  assert.equal(noKey.status, 400)
  const plan = await call<DispatchPlanResponse>(postPlan, g.s, { body: { shipmentIds: g.ids } })
  const key = plan.body.plan.groups[0]?.key
  const group = await call<AvailabilityResponse>(postGroupAvailability, g.s, { body: { shipmentIds: g.ids, groupKey: key } })
  noStore(group)
  assert.equal(group.status, 200)
  assert.ok(group.body.ranges.length > 0)
  assert.equal(g.s.dispatches.rows.length, 0, "nothing stored")
})

test("availability answers today and nowTime in Europe/Warsaw", async () => {
  const w = world(1)
  const made = await createdVia(w, true)
  const now = new Date("2026-11-03T23:30:00Z")
  const answer = await courierAvailability(w.s.container, made.dispatch.id, { now })
  assert.equal(answer.today, "2026-11-04", "past midnight in Warsaw (CET, UTC+1)")
  assert.equal(answer.nowTime, "00:30")
  assert.equal(answer.days[0], "2026-11-04")
})

test("cancel, exclude, restore, withdraw: shapes and refusals", async () => {
  const w = world(2)
  const made = await createdVia(w)
  const id = made.dispatch.id
  const notFree = await call<ErrorResponse>(postExclude, w.s, { params: { id: w.ids[0] } })
  assert.equal(notFree.status, 409)
  assert.equal(notFree.body.code, "not_candidate")
  const out = await call<WithdrawResponse>(postWithdraw, w.s, { params: { id: w.ids[0] } })
  noStore(out)
  assert.equal(out.body.withdrawn, true)
  assert.equal(out.body.shipment.id, w.ids[0])
  assert.deepEqual(out.body.dispatch.shipmentIds, [w.ids[1]])
  const again = await call<ErrorResponse>(postWithdraw, w.s, { params: { id: w.ids[0] } })
  assert.equal(again.status, 409)
  assert.equal(again.body.code, "not_candidate")
  const excluded = await call<ActionResponse>(postExclude, w.s, { params: { id: w.ids[0] } })
  noStore(excluded)
  assert.equal(excluded.body.shipment.state, "excluded")
  const restored = await call<ActionResponse>(postRestore, w.s, { params: { id: w.ids[0] } })
  assert.equal(restored.body.shipment.state, "created")
  const canceled = await call<DispatchResponse>(postCancel, w.s, { params: { id } })
  assert.equal(canceled.body.dispatch.state, "canceled")
  const twice = await call<ErrorResponse>(postCancel, w.s, { params: { id } })
  assert.equal(twice.status, 409)
  assert.equal(twice.body.code, "wrong_state")
  assert.equal(w.fake.calls.length, 0)
})

test("the write guard of /admin/dpd* covers the dispatch routes: a form post is 415", () => {
  const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Array<(req: never, res: never, next: () => void) => void> }> }).routes
  const admin = routes.find((r) => r.matcher === "/admin/dpd*")
  assert.ok(admin)
  const paths = [
    "dispatch-plan",
    "dispatches",
    "courier-availability",
    "dispatches/dpddsp_1/print",
    "dispatches/dpddsp_1/order",
    "dispatches/dpddsp_1/reschedule",
    "dispatches/dpddsp_1/cancel-courier",
    "dispatches/dpddsp_1/resolve",
    "dispatches/dpddsp_1/cancel",
    "shipments/dpdshp_1/exclude",
    "shipments/dpdshp_1/restore",
    "shipments/dpdshp_1/withdraw",
  ]
  for (const path of paths) {
    const out = { status: 0 }
    const res = { status: (c: number) => ((out.status = c), res), json: () => res }
    admin.middlewares[0]({ method: "POST", url: `/admin/dpd/${path}`, headers: { "content-type": "text/plain" } } as never, res as never, () => {})
    assert.equal(out.status, 415, path)
  }
})

test("stage 5: withdraw, exclude and cancel answer 409 already_shipped after the pickup; 040201 without possession still withdraws", async () => {
  const w = world(3)
  const made = await createdVia(w, true)
  const at = "2026-11-03T08:00:00.000Z"
  const entry = (waybill: string, code: string, stage: string, possession: boolean) => [
    { waybill, box: 0, role: "outbound", stage, code, at, possession, lastCode: code, lastAt: at, description: null, supersededBy: null, supersededAt: null, from: null, checkedAt: at, done: false },
  ]
  const set = (id: string, code: string, stage: string, possession: boolean) => {
    const row = w.s.shipments.rows.find((r) => r.id === id)
    assert.ok(row)
    Object.assign(row, { stage, tracking: entry(String((row.waybills as string[])[0]), code, stage, possession) })
  }
  set(w.ids[0], "040101", "in_transit", true)
  set(w.ids[1], "040201", "problem", false)
  for (const [handler, params] of [
    [postWithdraw, { id: w.ids[0] }],
    [postCancel, { id: made.dispatch.id }],
  ] as const) {
    const refused = await call<ErrorResponse>(handler, w.s, { params })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, "already_shipped")
    noStore(refused)
  }
  const out = await call<WithdrawResponse>(postWithdraw, w.s, { params: { id: w.ids[1] } })
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal(out.body.withdrawn, true)
  const lone = insertLabeled(w.s, labeledOrder(9), { shipped_marked_at: new Date() })
  const excluded = await call<ErrorResponse>(postExclude, w.s, { params: { id: String(lone.id) } })
  assert.equal(excluded.status, 409)
  assert.equal(excluded.body.code, "already_shipped")
})
