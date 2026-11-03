/**
 * Changing the DPD Pickup point of a shipment (POST .../point, changePoint,
 * spec 6.2): every refusal with its code, the point checked fresh and never
 * accepted unchecked, the box problems left to the plan, the stored DPD
 * answers about the old point dropped, the history line, the order and the
 * fulfillment untouched, no armed writer needed, and a change that lands
 * between the plan and the claim of a create: nothing goes to DPD with the
 * old point (nor with the old boxes, which the claim never overwrites). A slow read of the old point that ends after a change (or two
 * changes at once) never writes the old point's problems on the row. Sandbox catalog, fake DPDServices, memory store, no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ErrorResponse, PlanResponse } from "../src/modules/dpd/lib/contract.ts"
import { catalogPoint } from "../src/modules/dpd/lib/mypudo.ts"
import { catalogSource, SANDBOX_POINTS, type PointsSource } from "../src/modules/dpd/lib/points.ts"
import type { DpdStore } from "../src/modules/dpd/lib/store.ts"
import { createAttempt, createShipment } from "../src/workflows/dpd/create.ts"
import { planForShipment, refreshProblems, setBoxes } from "../src/workflows/dpd/plan.ts"
import { changePoint } from "../src/workflows/dpd/points.ts"
import { recordFulfillment } from "../src/workflows/dpd/shipments.ts"
import { POST as postPoint } from "../src/api/admin/dpd/shipments/[id]/point/route.ts"
import { FakeDpdServices } from "./fake-dpdservices.ts"
import { arm, countingPoints, order, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

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
  assert.equal(requests, 0, "only the fakes are ever called")
})

const ORDER = "order_01KODA0000000000000000001"
const FUL = "ful_01KODA0000000000000000001"
const ADMIN = "user_01ADMIN"

/** The sandbox catalog and two points of the tests: one more that hands out parcels, one without cash on delivery. */
const POINTS = [
  ...SANDBOX_POINTS,
  catalogPoint({ id: "PL0SBX03", name: "Punkt testowy drugi", type: "100", line1: "Testowa 3", zip: "02-495", city: "Warszawa", active: true, services: ["100", "101"] }),
  catalogPoint({ id: "PL0SBX04", name: "Punkt testowy bez pobrania", type: "100", line1: "Testowa 4", zip: "02-495", city: "Warszawa", active: true, services: ["100"] }),
  catalogPoint({ id: "DE0SBX01", name: "Testpunkt", type: "100", line1: "Teststr. 1", zip: "10115", city: "Berlin", country: "DE", active: true, services: ["100"] }),
]

function pickupData(option: "dpd-pickup" | "dpd-pickup-cod", pudoId: string | null): Row {
  return { dpd_option: option, dpd_kind: "pickup", dpd_cod: option === "dpd-pickup-cod", dpd_pudo_id: pudoId, dpd_country: "PL" }
}

function pickupOrder(data: Row, over: Row = {}): Row {
  return order({
    id: ORDER,
    items: [{ id: "li_1", quantity: 1, variant: { weight: 1500 } }],
    shipping_methods: [{ id: "sm_01", name: "DPD Pickup", shipping_option_id: "so_01", data }],
    fulfillments: [{ id: FUL, provider_id: "dpd_dpd", data, canceled_at: null }],
    ...over,
  })
}

type Ready = { s: Setup; id: string; fake: FakeDpdServices; points: ReturnType<typeof countingPoints> }

async function ready(opts: { data?: Row; options?: Row; points?: PointsSource; over?: Row } = {}): Promise<Ready> {
  const fake = new FakeDpdServices({ pudoIds: ["PL14509", "PL0SBX03"] })
  const points = countingPoints(opts.points ?? catalogSource("sandbox", POINTS))
  const s = setup((opts.options ?? { ...SANDBOX, shipmentWriter: true }) as never, [pickupOrder(opts.data ?? pickupData("dpd-pickup", "PL14509"), opts.over)], { fake, points })
  const row = await recordFulfillment(s.container, ORDER, FUL)
  assert.ok(row)
  return { s, id: String(row.id), fake, points }
}

function rowOf(s: Setup, id: string): Row {
  const row = s.shipments.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

async function refusedWith(work: Promise<unknown>, status: number, code: string): Promise<{ problems?: Array<{ code: string }> }> {
  let caught: { problems?: Array<{ code: string }> } = {}
  await assert.rejects(work, (err: unknown) => {
    const e = err as { status?: number; code?: string; problems?: Array<{ code: string }> }
    assert.equal(e.status, status)
    assert.equal(e.code, code)
    caught = e
    return true
  })
  return caught
}

type Answer<T> = { status: number; body: T; headers: Record<string, string> }

async function post<T>(s: Setup, id: string, body: Row): Promise<Answer<T>> {
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
    json(b: unknown) {
      out.body = b
      return res
    },
  }
  await postPoint({ scope: s.container, query: {}, params: { id }, body, headers: {}, auth_context: { actor_id: ADMIN } } as never, res as never)
  return out as Answer<T>
}

const codes = (list: Array<{ code: string }> | undefined) => (list ?? []).map((p) => p.code)

test("refused before anything is read: a bad id 400, no row 404, a courier row 409 not_pickup, a labeled row 409 wrong_state", async () => {
  const { s, id, points } = await ready()
  const reads = points.reads
  await refusedWith(changePoint(s.container, id, "14509", ADMIN), 400, "invalid")
  await refusedWith(changePoint(s.container, id, "", ADMIN), 400, "invalid")
  await refusedWith(changePoint(s.container, "dpdshp_none", "PL0SBX03", ADMIN), 404, "not_found")
  rowOf(s, id).option_id = "dpd-courier"
  await refusedWith(changePoint(s.container, id, "PL0SBX03", ADMIN), 409, "not_pickup")
  rowOf(s, id).option_id = "dpd-pickup"
  rowOf(s, id).kind = "return"
  await refusedWith(changePoint(s.container, id, "PL0SBX03", ADMIN), 409, "not_pickup")
  rowOf(s, id).kind = "outbound"
  rowOf(s, id).state = "labeled"
  await refusedWith(changePoint(s.container, id, "PL0SBX03", ADMIN), 409, "wrong_state")
  assert.equal(points.reads, reads, "no point read for a refused request")
  const bad = await post<ErrorResponse>(s, id, { pudoId: 14509 })
  assert.equal(bad.status, 400)
  assert.equal(bad.headers["cache-control"], "private, no-store")
})

test("the same point: no write and no history line, the plan as GET plan gives it", async () => {
  const { s, id } = await ready()
  const before = JSON.stringify(rowOf(s, id))
  const events = s.events.rows.length
  const { row, plan } = await changePoint(s.container, id, "pl14509", ADMIN)
  assert.equal(row.pudo_id, "PL14509")
  assert.equal(plan.ok, true)
  assert.equal(JSON.stringify(rowOf(s, id)), before)
  assert.equal(s.events.rows.length, events)
})

test("422 point_refused with the problems of the point: inactive, no service 100, no cash on delivery for COD, unknown, abroad; nothing written", async () => {
  const pickup = await ready()
  for (const [pudoId, expected] of [
    ["PL0SBX01", ["pudo_inactive"]],
    ["PL0SBX02", ["pudo_no_delivery"]],
    ["PL0SBX99", ["pudo_not_found"]],
    ["DE0SBX01", ["abroad_later"]],
  ] as const) {
    const e = await refusedWith(changePoint(pickup.s.container, pickup.id, pudoId, ADMIN), 422, "point_refused")
    assert.deepEqual(codes(e.problems), expected, pudoId)
  }
  const route = await post<ErrorResponse>(pickup.s, pickup.id, { pudoId: "PL0SBX99" })
  assert.equal(route.status, 422)
  assert.deepEqual(route.body.problems, [{ code: "pudo_not_found", field: "pudoId", detail: "PL0SBX99" }])
  assert.equal(rowOf(pickup.s, pickup.id).pudo_id, "PL14509", "nothing written")

  const cod = await ready({ data: pickupData("dpd-pickup-cod", "PL14509") })
  const e = await refusedWith(changePoint(cod.s.container, cod.id, "PL0SBX04", ADMIN), 422, "point_refused")
  assert.deepEqual(codes(e.problems), ["pudo_no_cod"])
  const abroad = await refusedWith(changePoint(cod.s.container, cod.id, "DE0SBX01", ADMIN), 422, "point_refused")
  assert.deepEqual(codes(abroad.problems), ["pudo_no_cod", "abroad_later", "cod_pickup_abroad"])
  assert.equal(pickup.s.events.rows.filter((x) => (x.data as Row | null)?.action === "point_changed").length, 0)
})

test("never fail open: 503 points_unavailable when MyPudo is not configured, 502 on a timeout or a throw; nothing written", async () => {
  const { s, id, points } = await ready()
  points.fail.details = "not_configured"
  await refusedWith(changePoint(s.container, id, "PL0SBX03", ADMIN), 503, "points_unavailable")
  points.fail.details = "timeout"
  await refusedWith(changePoint(s.container, id, "PL0SBX03", ADMIN), 502, "points_unavailable")
  const route = await post<ErrorResponse>(s, id, { pudoId: "PL0SBX03" })
  assert.equal(route.status, 502)
  assert.ok(!/https?:/.test(route.body.message))
  points.fail.details = undefined
  points.fail.throws = true
  await refusedWith(changePoint(s.container, id, "PL0SBX03", ADMIN), 502, "points_unavailable")
  assert.equal(rowOf(s, id).pudo_id, "PL14509")

  /* The source of the mode itself: live without MyPudo credentials. */
  const bare = setup({ ...SANDBOX, mode: "live" }, [pickupOrder(pickupData("dpd-pickup", "PL14509"))])
  const row = await recordFulfillment(bare.container, ORDER, FUL)
  await refusedWith(changePoint(bare.container, String(row?.id), "PL0SBX03", ADMIN), 503, "points_unavailable")
})

test("a change: the point and the problems in one write, the history with from, to and who, the order and the fulfillment untouched, no armed writer; the answer is the new plan", async () => {
  const { s, id, points } = await ready({ options: { ...SANDBOX } })
  const { plan: old } = await planForShipment(s.container, id)
  /* The last attempt failed: DPD did not know the old point, and said something else too. */
  Object.assign(rowOf(s, id), {
    state: "failed",
    problems: [
      { code: "pudo_not_found", field: "INCORRECT_PUDO", detail: "PL14509", source: "dpd" },
      { code: "dpd_validation", field: "sender.phone", detail: "Incorrect sender phone" },
    ],
  })
  const methods = JSON.stringify(s.orders.get(ORDER)?.shipping_methods)
  const fulfillment = JSON.stringify(s.fulfillments.get(FUL))
  const reads = points.reads
  const answer = await post<PlanResponse>(s, id, { pudoId: " pl0sbx03 " })
  assert.equal(answer.status, 200)
  assert.equal(answer.headers["cache-control"], "private, no-store")
  assert.equal(points.reads, reads + 1, "one read of the point for the change and its plan")
  assert.equal(answer.body.shipment.pudoId, "PL0SBX03")
  assert.equal(answer.body.plan.point?.pudoId, "PL0SBX03")
  assert.equal(answer.body.plan.point?.check, "ok")
  assert.equal(answer.body.plan.point?.source, "sandbox")
  assert.notEqual(answer.body.plan.hash, old.hash, "another point is another request")
  assert.equal(answer.body.writerArmed, false, "no writer was needed")
  assert.deepEqual(codes(answer.body.shipment.problems), ["dpd_validation"], "the DPD answer about the old point is gone, the rest stays")
  const stored = rowOf(s, id)
  assert.equal(stored.pudo_id, "PL0SBX03")
  assert.equal(stored.state, "failed")
  const event = s.events.rows.at(-1)
  assert.deepEqual(event?.data, { action: "point_changed", from: "PL14509", to: "PL0SBX03" })
  assert.equal(event?.actor, ADMIN)
  assert.equal(event?.source, "admin")
  assert.match(String(event?.message), /PL14509 to PL0SBX03/)
  assert.equal(JSON.stringify(s.orders.get(ORDER)?.shipping_methods), methods, "the order keeps the customer's choice")
  assert.equal(JSON.stringify(s.fulfillments.get(FUL)), fulfillment)
})

test("the box problems do not block a change; the plan shows them", async () => {
  const { s, id } = await ready({ over: { items: [{ id: "li_1", quantity: 2, variant: { weight: 1500 } }] } })
  rowOf(s, id).boxes = { edited: true, items: [1, 2].map((n) => ({ weightKg: n, lengthCm: null, widthCm: null, heightCm: null, reference: null, waybill: null })) }
  const { row, plan } = await changePoint(s.container, id, "PL0SBX03", ADMIN)
  assert.equal(row.pudo_id, "PL0SBX03")
  assert.deepEqual(codes(plan.problems), ["multi_box_not_allowed"])
  assert.deepEqual(codes(row.problems as Array<{ code: string }>), ["multi_box_not_allowed"])
})

test("a row without a point or with a wrong id is the one that needs a change: both work", async () => {
  const missing = await ready({ data: pickupData("dpd-pickup", null) })
  assert.deepEqual(codes((await planForShipment(missing.s.container, missing.id)).plan.problems), ["pudo_missing"])
  const fixed = await changePoint(missing.s.container, missing.id, "PL14509", ADMIN)
  assert.equal(fixed.plan.ok, true)
  assert.equal(fixed.row.pudo_id, "PL14509")
  assert.equal(fixed.row.problems, null)
  assert.equal(fixed.row.country_code, "PL")

  const wrong = await ready()
  rowOf(wrong.s, wrong.id).pudo_id = "14509"
  assert.deepEqual(codes((await planForShipment(wrong.s.container, wrong.id)).plan.problems), ["pudo_invalid"])
  const again = await changePoint(wrong.s.container, wrong.id, "PL14509", ADMIN)
  assert.equal(again.plan.ok, true)
  assert.deepEqual(wrong.s.events.rows.at(-1)?.data, { action: "point_changed", from: "14509", to: "PL14509" })
})

test("a change between the plan and the claim of a create: 409 plan_changed, nothing sent, the new point kept, nothing claimed", async () => {
  for (const trigger of ["manual", "auto"] as const) {
    const { s, id, fake } = await ready()
    arm(s, "shipment")
    const { plan } = await planForShipment(s.container, id)
    const before = { ...rowOf(s, id) }
    const store = s.container.resolve<DpdStore>("dpdShipmentStore")
    const claim = store.claim
    let raced = false
    store.claim = async (rowId, from, args) => {
      if (!raced) {
        raced = true
        await changePoint(s.container, id, "PL0SBX03", ADMIN)
      }
      return claim(rowId, from, args)
    }
    const input = { planHash: plan.hash, actor: trigger === "manual" ? ADMIN : null, trigger }
    if (trigger === "manual") await refusedWith(createShipment(s.container, id, input), 409, "plan_changed")
    else assert.equal((await createAttempt(s.container, id, input)).sent, false)
    assert.equal(fake.calls.length, 0, "nothing went to DPD with the old point")
    const row = rowOf(s, id)
    assert.equal(row.pudo_id, "PL0SBX03")
    assert.equal(row.state, "pending")
    assert.equal(row.attempts, 0, "the claim is not counted")
    assert.equal(row.claim_token, null)
    for (const column of ["plan_hash", "service", "session_type", "cod_minor", "boxes", "reference", "error", "error_code"]) {
      assert.deepEqual(row[column], before[column], `${trigger}: ${column} as before the claim`)
    }
  }
})

test("a create refused after a change keeps the problems of the new point: the answer of DPD about the old one does not come back (E18, DS6)", async () => {
  for (const trigger of ["manual", "auto"] as const) {
    const { s, id, fake } = await ready()
    arm(s, "shipment")
    Object.assign(rowOf(s, id), {
      state: "failed",
      error_code: "incorrect_data",
      problems: [
        { code: "pudo_not_found", field: "INCORRECT_PUDO", detail: "PL14509", source: "dpd" },
        { code: "dpd_validation", field: "sender.phone", detail: "Incorrect sender phone" },
      ],
    })
    const { plan } = await planForShipment(s.container, id)
    const store = s.container.resolve<DpdStore>("dpdShipmentStore")
    const claim = store.claim
    let raced = false
    store.claim = async (rowId, from, args) => {
      if (!raced) {
        raced = true
        await changePoint(s.container, id, "PL0SBX03", ADMIN)
        assert.deepEqual(codes(rowOf(s, id).problems as Array<{ code: string }>), ["dpd_validation"], "the change dropped the old answer")
      }
      return claim(rowId, from, args)
    }
    const input = { planHash: plan.hash, actor: trigger === "manual" ? ADMIN : null, trigger }
    if (trigger === "manual") await refusedWith(createShipment(s.container, id, input), 409, "plan_changed")
    else assert.equal((await createAttempt(s.container, id, input)).sent, false)
    assert.equal(fake.calls.length, 0)
    const row = rowOf(s, id)
    assert.equal(row.pudo_id, "PL0SBX03")
    assert.equal(row.state, "failed")
    assert.equal(row.error_code, "incorrect_data")
    assert.deepEqual(codes(row.problems as Array<{ code: string }>), ["dpd_validation"], `${trigger}: no answer about PL14509 on a row at PL0SBX03`)
    const again = await planForShipment(s.container, id)
    assert.deepEqual(codes(again.row.problems as Array<{ code: string }>), ["dpd_validation"], `${trigger}: the plan does not bring it back`)
  }
})

test("boxes set between the plan and the claim of a create: 409 plan_changed, nothing sent, the boxes set by hand kept", async () => {
  for (const trigger of ["manual", "auto"] as const) {
    const { s, id, fake } = await ready()
    arm(s, "shipment")
    const { plan } = await planForShipment(s.container, id)
    const before = { ...rowOf(s, id) }
    const store = s.container.resolve<DpdStore>("dpdShipmentStore")
    const claim = store.claim
    let raced = false
    store.claim = async (rowId, from, args) => {
      if (!raced) {
        raced = true
        await setBoxes(s.container, id, [{ weightKg: 19, lengthCm: 40, widthCm: 30, heightCm: 20 }], ADMIN)
      }
      return claim(rowId, from, args)
    }
    const input = { planHash: plan.hash, actor: trigger === "manual" ? ADMIN : null, trigger }
    if (trigger === "manual") await refusedWith(createShipment(s.container, id, input), 409, "plan_changed")
    else assert.equal((await createAttempt(s.container, id, input)).sent, false)
    assert.equal(fake.calls.length, 0, "nothing went to DPD with the old boxes")
    const row = rowOf(s, id)
    assert.deepEqual(row.boxes, { edited: true, items: [{ weightKg: 19, lengthCm: 40, widthCm: 30, heightCm: 20, reference: null, waybill: null }] }, `${trigger}: the boxes set by hand`)
    assert.equal(row.state, "pending")
    assert.equal(row.attempts, 0, "nothing claimed, nothing counted")
    assert.equal(row.claim_token, null)
    for (const column of ["plan_hash", "service", "session_type", "cod_minor", "reference", "error", "error_code"]) {
      assert.deepEqual(row[column], before[column], `${trigger}: ${column} as before`)
    }
    const actions = s.events.rows.map((e) => (e.data as { action?: string } | null)?.action)
    assert.equal(actions.at(-1), "boxes_changed")
    assert.ok(!actions.includes("create_sent"), `${trigger}: no history line says it was sent`)
    const again = await planForShipment(s.container, id)
    assert.equal(again.plan.boxesSource, "edited")
    assert.equal(again.plan.boxes[0]?.weightKg, 19, "the next plan sends what was set")
  }
})

/**
 * A source whose next read of `pudoId` waits until `open()`, then answers that
 * the point is inactive; every other read is the catalog of the tests.
 */
function slowPoint(pudoId: string) {
  const base = catalogSource("sandbox", POINTS)
  const inactive = catalogPoint({ id: pudoId, name: "Punkt nieczynny", type: "100", line1: "Testowa 1", zip: "02-495", city: "Warszawa", active: false, services: ["100", "101"] })
  let armed = false
  let release: () => void = () => {}
  let reached: () => void = () => {}
  const waiting = new Promise<void>((r) => (reached = r))
  const source: PointsSource = {
    kind: base.kind,
    search: (q) => base.search(q),
    async details(id) {
      if (!armed || id !== pudoId) return base.details(id)
      armed = false
      reached()
      await new Promise<void>((r) => (release = r))
      return { status: "ok", pudoId: id, point: inactive }
    },
  }
  return { source, waiting, arm: () => void (armed = true), open: () => release() }
}

test("a plan read of the old point that ends after a change writes nothing on the row: the new point keeps its own problems", async () => {
  const slow = slowPoint("PL14509")
  const { s, id } = await ready({ points: slow.source })
  assert.equal(rowOf(s, id).problems, null)

  /* GET plan waits on PL14509, a change to PL0SBX03 lands, then MyPudo says PL14509 is inactive. */
  slow.arm()
  const reading = planForShipment(s.container, id)
  await slow.waiting
  await changePoint(s.container, id, "PL0SBX03", ADMIN)
  slow.open()
  const read = await reading
  assert.equal(rowOf(s, id).pudo_id, "PL0SBX03")
  assert.equal(rowOf(s, id).problems, null, "no pudo_inactive about PL14509 on a row at PL0SBX03")
  assert.equal(read.row.pudo_id, "PL0SBX03", "the answer is read again for the new point")
  assert.equal(read.plan.problems.length, 0)

  /* The problems a create would store: not written, 409 plan_changed instead of the old point's 422. */
  const slowCreate = slowPoint("PL14509")
  const b = await ready({ points: slowCreate.source })
  arm(b.s, "shipment")
  slowCreate.arm()
  const creating = createShipment(b.s.container, b.id, { planHash: "x", actor: ADMIN, trigger: "manual" })
  await slowCreate.waiting
  await changePoint(b.s.container, b.id, "PL0SBX03", ADMIN)
  slowCreate.open()
  await refusedWith(creating, 409, "plan_changed")
  assert.equal(rowOf(b.s, b.id).pudo_id, "PL0SBX03")
  assert.equal(rowOf(b.s, b.id).problems, null)
  assert.equal(b.fake.calls.length, 0)

  /* refreshProblems: not written; the answer is the row as it is now. */
  const slowRefresh = slowPoint("PL14509")
  const c = await ready({ points: slowRefresh.source })
  slowRefresh.arm()
  const refreshing = refreshProblems(c.s.container, { ...rowOf(c.s, c.id) } as never)
  await slowRefresh.waiting
  await changePoint(c.s.container, c.id, "PL0SBX03", ADMIN)
  slowRefresh.open()
  assert.equal((await refreshing).pudo_id, "PL0SBX03")
  assert.equal(rowOf(c.s, c.id).problems, null)
})

test("two point changes at once: the second finds the point moved and writes nothing; one history line with the true from", async () => {
  const slow = slowPoint("PL0SBX03")
  const { s, id } = await ready({ points: slow.source })
  slow.arm()
  /* The read of PL0SBX03 waits (and will answer it is inactive); a change to PL0SBX04 lands meanwhile. */
  const first = changePoint(s.container, id, "PL0SBX03", ADMIN)
  await slow.waiting
  await changePoint(s.container, id, "PL0SBX04", ADMIN)
  slow.open()
  await refusedWith(first, 422, "point_refused")

  /* Now a slow read that ends with an accepted point: the change is refused with 409, the row stays at PL0SBX04. */
  const ok = await ready()
  const store = ok.s.container.resolve<DpdStore>("dpdShipmentStore")
  const transition = store.transition.bind(store)
  let raced = false
  store.transition = async (rowId, from, patch, expect) => {
    if (!raced && patch.pudo_id === "PL0SBX03") {
      raced = true
      await changePoint(ok.s.container, ok.id, "PL0SBX04", ADMIN)
    }
    return transition(rowId, from, patch, expect)
  }
  await refusedWith(changePoint(ok.s.container, ok.id, "PL0SBX03", ADMIN), 409, "wrong_state")
  assert.equal(rowOf(ok.s, ok.id).pudo_id, "PL0SBX04")
  const lines = ok.s.events.rows.filter((e) => (e.data as Row | null)?.action === "point_changed")
  assert.equal(lines.length, 1)
  assert.deepEqual([(lines[0].data as Row).from, (lines[0].data as Row).to], ["PL14509", "PL0SBX04"])
})

test("boxes set while a plan read waits: the read writes nothing, the row keeps the problems of its new boxes", async () => {
  const slow = slowPoint("PL14509")
  const { s, id } = await ready({ points: slow.source })
  slow.arm()
  const reading = planForShipment(s.container, id)
  await slow.waiting
  await setBoxes(s.container, id, [{ weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 }], ADMIN)
  const after = rowOf(s, id).problems
  slow.open()
  await reading
  assert.deepEqual(rowOf(s, id).problems, after, "the problems of the edited boxes, not of the read that began before them")
  assert.ok(!codes((rowOf(s, id).problems ?? []) as Array<{ code: string }>).includes("pudo_inactive"))
})
