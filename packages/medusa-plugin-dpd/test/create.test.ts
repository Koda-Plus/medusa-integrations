/**
 * Creating a shipment and getting its label, exactly once, against the fake
 * DPDServices (test/fake-dpdservices.ts) and the memory store: the writer
 * and the plan checked before anything is sent, one numbers call and one
 * labels call on the happy path, a refusal that keeps the reference, an
 * unclear answer that is never sent again, a duplicate taken over, a label
 * that did not come, the payer refused, cash on delivery on the first box
 * of an order only, demo mode without a single fetch, and Pickup: one box to
 * a checked point, the answers of DPD kept with their source, no automatic
 * send to a point nobody could check (DS13). No network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { createAttempt, createShipment, labelAttempt, labelShipment, withAttempt, boxesWithWaybills, labelSearchOf } from "../src/workflows/dpd/create.ts"
import { labelsRequest, type DpdServicesClient } from "../src/modules/dpd/lib/dpdservices.ts"
import { mergeProblems, planForShipment } from "../src/workflows/dpd/plan.ts"
import { recordFulfillment } from "../src/workflows/dpd/shipments.ts"
import { acceptShipment, skipShipment } from "../src/workflows/dpd/resolve.ts"
import { problemsOf, toShipmentDto, type ShipmentRow } from "../src/modules/dpd/lib/dto.ts"
import { catalogSource, SANDBOX_POINTS } from "../src/modules/dpd/lib/points.ts"
import type { DpdPluginOptions } from "../src/modules/dpd/lib/options.ts"
import { FakeDpdServices, loadFixture, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"
import { arm, countingPoints, order, SANDBOX, settle, setup, type CountingPoints, type Row, type Setup } from "./helpers.ts"

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
const FUL2 = "ful_01KODA0000000000000000002"
const ADMIN = "user_01ADMIN"
const WRITING: DpdPluginOptions = { ...SANDBOX, shipmentWriter: true }
const COURIER = { dpd_option: "dpd-courier", dpd_kind: "courier", dpd_cod: false, dpd_country: "PL" }
const COURIER_COD = { dpd_option: "dpd-courier-cod", dpd_kind: "courier", dpd_cod: true, dpd_country: "PL" }

/** A courier order whose variants weigh 2 x 1.2 kg. */
function courierOrder(over: Row = {}, fulfillment: Row = {}): Row {
  return order({
    id: ORDER,
    items: [{ id: "li_1", quantity: 2, variant: { weight: 1200 } }],
    fulfillments: [{ id: FUL, provider_id: "dpd_dpd", data: COURIER, canceled_at: null, ...fulfillment }],
    ...over,
  })
}

type Ready = { s: Setup; fake: FakeDpdServices; id: string; hash: string }

async function ready(opts: { options?: DpdPluginOptions; orders?: Row[]; fake?: FakeDpdServices; armed?: boolean } = {}): Promise<Ready> {
  const fake = opts.fake ?? new FakeDpdServices()
  const s = setup(opts.options ?? WRITING, opts.orders ?? [courierOrder()], { fake })
  if (opts.armed !== false) arm(s, "shipment")
  const row = await recordFulfillment(s.container, ORDER, FUL)
  assert.ok(row, "the fulfillment is recorded")
  const { plan } = await planForShipment(s.container, String(row.id))
  return { s, fake, id: String(row.id), hash: plan.hash }
}

function manual(hash: string | null) {
  return { planHash: hash, actor: ADMIN, trigger: "manual" as const }
}

function rowOf(s: Setup, id: string): Row {
  const row = s.shipments.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

function actions(s: Setup, id: string): string[] {
  return s.events.rows.filter((e) => e.shipment_id === id).map((e) => String((e.data as Row | null)?.action ?? ""))
}

async function refusedWith(work: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(work, (err: unknown) => {
    const e = err as { status?: number; code?: string }
    assert.equal(e.status, status)
    assert.equal(e.code, code)
    return true
  })
}

test("refused before anything is sent: the writer off, not armed, not configured; no plan hash, another hash; a plan with problems", async () => {
  const off = await ready({ options: SANDBOX })
  await refusedWith(createShipment(off.s.container, off.id, manual(off.hash)), 409, "writer_off")
  const unarmed = await ready({ armed: false })
  await refusedWith(createShipment(unarmed.s.container, unarmed.id, manual(unarmed.hash)), 409, "not_armed")
  const bare = await ready({ options: { shipmentWriter: true, sender: SANDBOX.sender } })
  await refusedWith(createShipment(bare.s.container, bare.id, manual(bare.hash)), 409, "not_configured")

  const r = await ready()
  await refusedWith(createShipment(r.s.container, r.id, manual(null)), 400, "plan_hash_missing")
  await refusedWith(createShipment(r.s.container, r.id, manual("0".repeat(64))), 409, "plan_changed")
  assert.equal(rowOf(r.s, r.id).state, "pending")
  assert.equal(rowOf(r.s, r.id).attempts, 0, "nothing claimed")

  const heavy = await ready({ orders: [courierOrder({ items: [{ id: "li_1", quantity: 1, variant: { weight: null } }] })] })
  await refusedWith(createShipment(heavy.s.container, heavy.id, manual(heavy.hash)), 422, "plan_problems")
  assert.deepEqual((rowOf(heavy.s, heavy.id).problems as Array<{ code: string }>).map((p) => p.code), ["weight_missing"])

  for (const x of [off, unarmed, bare, r, heavy]) assert.equal(x.fake.calls.length, 0, "not a single call to DPD")
})

test("the happy path: one numbers call and one labels call, labeled, the label stored, the fulfillment noted, the history", async () => {
  const { s, fake, id, hash } = await ready()
  const row = await createShipment(s.container, id, manual(hash))
  assert.equal(fake.count("numbers"), 1)
  assert.equal(fake.count("labels"), 1)
  assert.equal(row.state, "labeled")
  assert.equal(row.reference, FUL, "the fulfillment id is the reference")
  assert.equal(row.plan_hash, hash)
  assert.equal(row.claim_token, null)
  assert.equal(row.lease_until, null)
  assert.equal(row.attempts, 2, "one claim for the numbers, one for the label")
  const waybills = row.waybills as string[]
  assert.equal(waybills.length, 1)
  assert.match(String(row.session_id), /^\d+$/)
  const boxes = row.boxes as { edited: boolean; items: Array<{ weightKg: number; reference: string; waybill: string }> }
  assert.deepEqual(boxes.items.map((b) => [b.weightKg, b.reference, b.waybill]), [[2.4, `${FUL}-1`, waybills[0]]])
  assert.deepEqual((row.references as Array<{ reference: string; outcome: string }>).map((a) => [a.reference, a.outcome]), [[FUL, "ok"]])

  const sent = fake.calls[0].body as { packages: Array<{ reference: string; payerFID: number; parcels: Array<{ weight: number }> }> }
  assert.equal(sent.packages[0].reference, FUL)
  assert.equal(sent.packages[0].payerFID, 1000)
  assert.deepEqual(sent.packages[0].parcels.map((p) => p.weight), [2.4])
  const asked = fake.calls[1].body as { labelSearchParams: { session: { packages: Array<{ reference?: string }> } } }
  assert.equal(asked.labelSearchParams.session.packages[0].reference, FUL, "the label by the package reference")

  assert.equal(s.documents.rows.length, 1)
  assert.equal(s.documents.rows[0].data, TINY_PDF_BASE64, "the base64 kept as DPD sent it, never masked")
  assert.equal(s.documents.rows[0].created_by, ADMIN)
  assert.equal(s.documents.rows[0].mode, "sandbox")
  assert.deepEqual(s.fulfillments.get(FUL)?.data, { ...COURIER, dpd_shipment_id: id, dpd_waybills: waybills }, "merged into the provider's data")
  assert.deepEqual(actions(s, id).slice(1), ["create_sent", "created", "labeled"])
  assert.equal(s.events.rows.find((e) => (e.data as Row | null)?.action === "created")?.source, "admin")
  const stored = JSON.stringify(s.shipments.rows) + JSON.stringify(s.events.rows)
  for (const personal of ["Przykładowa", "+48 000 000 002", "anna@example.com", "Nowak"]) assert.ok(!stored.includes(personal), personal)

  await refusedWith(createShipment(s.container, id, manual(hash)), 409, "wrong_state")
  assert.equal(fake.count("numbers"), 1, "never a second shipment")
})

test("08e: DPD refuses the postal code; failed with its problem, the same reference sent again once fixed", async () => {
  const { s, fake, id, hash } = await ready()
  fake.failNext("numbers", { status: 400, body: loadFixture("08e-postal-code-with-dash").response.body })
  const failed = await createShipment(s.container, id, manual(hash))
  assert.equal(failed.state, "failed")
  assert.equal(failed.error_code, "incorrect_data")
  assert.ok((failed.problems as Array<{ code: string }>).some((p) => p.code.startsWith("dpd_")), "DPD's problem on the row")
  assert.ok(!String(failed.error).includes("30-001"), "the echoed value is never kept")
  assert.equal(fake.count("labels"), 0)
  assert.deepEqual(actions(s, id).slice(1), ["create_sent", "create_refused"])

  const { plan } = await planForShipment(s.container, id)
  assert.ok(plan.ok, "DPD's problems do not block the plan")
  const again = await createShipment(s.container, id, manual(plan.hash))
  assert.equal(again.state, "labeled")
  assert.deepEqual((again.references as Array<{ reference: string; outcome: string }>).map((a) => [a.reference, a.outcome]), [[FUL, "refused"], [FUL, "ok"]], "a refusal does not use the reference up")
  assert.equal(again.problems, null)
  assert.equal(again.error_code, null)
})

test("a timeout or a lost network is unknown and nothing is sent again; a lost answer is adopted by the next create as a duplicate", async () => {
  const timeout = await ready()
  timeout.fake.failNext("numbers", "timeout")
  const unknown = await createShipment(timeout.s.container, timeout.id, manual(timeout.hash))
  assert.equal(unknown.state, "unknown")
  assert.equal(timeout.fake.count("labels"), 0)
  await refusedWith(createShipment(timeout.s.container, timeout.id, manual(timeout.hash)), 409, "wrong_state")
  assert.equal(timeout.fake.count("numbers"), 1, "an unknown row is looked up, never sent again")

  const thrown = await ready()
  thrown.s.container.resolve<{ generatePackagesNumbers: unknown }>("dpdServicesClient").generatePackagesNumbers = async () => {
    throw new Error("client bug")
  }
  const unclear = await createShipment(thrown.s.container, thrown.id, manual(thrown.hash))
  assert.equal(unclear.state, "unknown", "anything thrown may have reached DPD")
  assert.equal(unclear.error_code, "network")

  const lost = await ready()
  lost.fake.failNext("numbers", "lose_answer")
  assert.equal((await createShipment(lost.s.container, lost.id, manual(lost.hash))).state, "unknown")
  assert.equal(lost.fake.packages.size, 1, "DPD stored it")
  /* A person sends it again after a lookup said "not found" (simulated): DPD answers a duplicate, taken over in the same claim. */
  lost.s.shipments.rows.find((r) => r.id === lost.id)!.state = "pending"
  const adopted = await createShipment(lost.s.container, lost.id, manual(lost.hash))
  assert.equal(adopted.state, "labeled")
  assert.equal(adopted.error_code, "adopted")
  assert.deepEqual(adopted.waybills, lost.fake.packages.get(FUL)?.parcels.map((p) => p.waybill))
  assert.equal(lost.fake.packages.size, 1, "still one shipment in DPD")
  assert.deepEqual(actions(lost.s, lost.id).slice(-2), ["create_sent", "adopted"])
})

test("a duplicate is taken over: same box count labeled, another count ambiguous, then accepted or skipped by a person", async () => {
  const same = new FakeDpdServices()
  const seeded = same.seedPackage(FUL, 1)
  const one = await ready({ fake: same })
  const adopted = await createShipment(one.s.container, one.id, manual(one.hash))
  assert.equal(adopted.state, "labeled")
  assert.deepEqual(adopted.waybills, seeded)
  assert.equal(one.s.documents.rows.length, 1)
  assert.deepEqual(one.s.fulfillments.get(FUL)?.data?.dpd_waybills, seeded)

  const more = new FakeDpdServices()
  const two = more.seedPackage(FUL, 2)
  const r = await ready({ fake: more })
  const ambiguous = await createShipment(r.s.container, r.id, manual(r.hash))
  assert.equal(ambiguous.state, "ambiguous")
  assert.equal(ambiguous.error_code, "waybill_count_mismatch")
  assert.deepEqual(ambiguous.waybills, two)
  assert.equal(r.s.fulfillments.get(FUL)?.data?.dpd_waybills, undefined, "nothing noted before a person decides")
  const accepted = await acceptShipment(r.s.container, r.id, ADMIN)
  assert.equal(accepted.state, "labeled", "the label came with the takeover")
  assert.deepEqual(r.s.fulfillments.get(FUL)?.data?.dpd_waybills, two)
  await refusedWith(acceptShipment(r.s.container, r.id, ADMIN), 409, "wrong_state")

  const again = new FakeDpdServices()
  again.seedPackage(FUL, 3)
  const x = await ready({ fake: again })
  await createShipment(x.s.container, x.id, manual(x.hash))
  assert.equal((await skipShipment(x.s.container, x.id, ADMIN)).state, "skipped")
  await refusedWith(skipShipment(x.s.container, x.id, ADMIN), 409, "wrong_state")
})

test("a label that did not come leaves the row created with a code; the label is asked for again by hand", async () => {
  const { s, fake, id, hash } = await ready()
  fake.failNext("labels", "timeout")
  const created = await createShipment(s.container, id, manual(hash))
  assert.equal(created.state, "created", "a label never makes a row unknown")
  assert.equal(created.error_code, "label_unclear")
  assert.equal(s.documents.rows.length, 0)
  assert.deepEqual(actions(s, id).slice(-1), ["label_failed"])
  assert.equal(s.fulfillments.get(FUL)?.data?.dpd_shipment_id, id, "the waybills are noted once DPD gave them")

  fake.failNext("labels", { status: 500, text: "Internal Server Error" })
  const still = await labelShipment(s.container, id, { actor: ADMIN, trigger: "manual" })
  assert.equal(still.state, "created")
  const labeled = await labelShipment(s.container, id, { page: "LBL_PRINTER", actor: ADMIN, trigger: "manual" })
  assert.equal(labeled.state, "labeled")
  assert.equal(labeled.error_code, null)
  assert.equal(s.documents.rows.length, 1)
  assert.equal(s.documents.rows[0].page, "LBL_PRINTER")
  assert.equal(fake.count("numbers"), 1)
  await refusedWith(labelShipment(s.container, id, { actor: ADMIN, trigger: "manual" }), 409, "wrong_state")
})

test("other waybills on the label: ambiguous with DPD's waybills, the stored ones in the history (E7a)", async () => {
  const { s, fake, id, hash } = await ready()
  fake.failNext("labels", "timeout")
  const created = await createShipment(s.container, id, manual(hash))
  const mine = created.waybills as string[]
  /* DPD now has other parcels under the reference. */
  fake.packages.set(FUL, { sessionId: 1, parcels: [{ reference: `${FUL}-1`, waybill: "0000899999999Q" }] })
  const row = await labelShipment(s.container, id, { actor: ADMIN, trigger: "manual" })
  assert.equal(row.state, "ambiguous")
  assert.equal(row.error_code, "waybill_mismatch")
  assert.deepEqual(row.waybills, ["0000899999999Q"])
  const event = s.events.rows.at(-1)?.data as Row
  assert.deepEqual(event.previous, mine)
})

test("401 is auth and 403 DISALLOWED_FID is payer_fid: failed, never unknown, the password nowhere", async () => {
  const auth = await ready()
  auth.fake.failNext("numbers", { status: 401, text: "" })
  const a = await createShipment(auth.s.container, auth.id, manual(auth.hash))
  assert.equal(a.state, "failed")
  assert.equal(a.error_code, "auth")
  assert.ok((a.problems as Array<{ code: string }>).some((p) => p.code === "dpd_auth"))

  const payer = await ready({ fake: new FakeDpdServices({ payerFids: [2000] }) })
  const p = await createShipment(payer.s.container, payer.id, manual(payer.hash))
  assert.equal(p.state, "failed")
  assert.equal(p.error_code, "payer_fid")
  for (const x of [auth, payer]) {
    const all = JSON.stringify(x.s.shipments.rows) + JSON.stringify(x.s.events.rows) + x.s.logs.join("\n")
    assert.ok(!all.includes(String(SANDBOX.password)), "the password never stored or logged")
  }
})

test("a DPD 429 on a click is failed rate_limited_manual (the person retries, the pass does not); on the background path it stays rate_limited", async () => {
  const click = await ready()
  click.fake.failNext("numbers", { status: 429 })
  const c = await createShipment(click.s.container, click.id, manual(click.hash))
  assert.equal(c.state, "failed")
  assert.equal(c.error_code, "rate_limited_manual")

  const auto = await ready()
  auto.fake.failNext("numbers", { status: 429 })
  const a = await createShipment(auto.s.container, auto.id, { planHash: auto.hash, actor: null, trigger: "auto" })
  assert.equal(a.state, "failed")
  assert.equal(a.error_code, "rate_limited")
})

test("cash on delivery of an order with two fulfillments: the amount goes with the first one only", async () => {
  const both = order({
    id: ORDER,
    items: [{ id: "li_1", quantity: 2, variant: { weight: 1200 } }],
    shipping_methods: [{ id: "sm_01", name: "DPD courier COD", shipping_option_id: "so_01", data: COURIER_COD }],
    fulfillments: [
      { id: FUL, provider_id: "dpd_dpd", data: COURIER_COD, canceled_at: null },
      { id: FUL2, provider_id: "dpd_dpd", data: COURIER_COD, canceled_at: null },
    ],
  })
  const fake = new FakeDpdServices()
  const s = setup(WRITING, [both], { fake })
  arm(s, "shipment")
  const first = (await recordFulfillment(s.container, ORDER, FUL)) as ShipmentRow
  const second = (await recordFulfillment(s.container, ORDER, FUL2)) as ShipmentRow
  /* The rows are recorded in the same millisecond: order them as the database would. */
  s.shipments.rows.find((r) => r.id === second.id)!.created_at = new Date(Date.now() + 1000)
  const p1 = (await planForShipment(s.container, first.id)).plan
  const p2 = (await planForShipment(s.container, second.id)).plan
  assert.ok(p1.codDue, "the first fulfillment carries the amount")
  assert.equal(p1.codDue?.currency, "PLN")
  assert.equal(p2.codDue, null, "the second does not collect it twice")
  const row = await createShipment(s.container, first.id, manual(p1.hash))
  assert.equal(row.state, "labeled")
  assert.equal(row.cod_minor, p1.codDue?.minor)
  const sent = fake.calls[0].body as { packages: Array<{ services?: Array<{ code: string }> }> }
  assert.equal(sent.packages[0].services?.[0].code, "COD")
  assert.equal((await planForShipment(s.container, second.id)).plan.codDue, null, "still none once the first was created")
})

test("demo mode: created and labeled by the simulated DPD, a real PDF, not one fetch; the auto create of a new fulfillment runs in the background", async () => {
  const s = setup({ demo: true, shipmentWriter: true, autoCreate: true }, [courierOrder()])
  arm(s, "shipment")
  const row = await recordFulfillment(s.container, ORDER, FUL)
  assert.equal(row?.state, "pending", "answered before the background work")
  await settle()
  const done = s.shipments.rows.find((r) => r.id === row?.id)
  assert.equal(done?.state, "labeled")
  assert.match(String((done?.waybills as string[])[0]), /^99\d{11}D$/, "a demo waybill looks invented")
  assert.ok(Buffer.from(String(s.documents.rows[0].data), "base64").subarray(0, 5).toString("latin1") === "%PDF-")
  assert.equal(s.fulfillments.get(FUL)?.data?.dpd_waybills, undefined, "demo rows never touch the fulfillment")
  assert.equal(s.events.rows.find((e) => (e.data as Row | null)?.action === "create_sent")?.source, "system")
})

test("helpers: the references history keeps the last 20, the waybills go into the boxes in order, the label search", () => {
  let list: unknown = null
  for (let i = 0; i < 25; i += 1) list = withAttempt(list, { reference: `r${i}`, parcels: [], at: "", trigger: "manual", outcome: "ok" })
  assert.equal((list as unknown[]).length, 20)
  assert.equal((list as Array<{ reference: string }>)[0].reference, "r5")
  const boxes = { edited: false, items: [1, 2].map((n) => ({ weightKg: n, lengthCm: null, widthCm: null, heightCm: null, reference: `x-${n}`, waybill: null })) }
  assert.deepEqual(boxesWithWaybills(boxes, ["w1"])?.items.map((b) => b.waybill), ["w1", null])
  assert.equal(boxesWithWaybills("nonsense", ["w1"]), null)
  assert.deepEqual(labelSearchOf({ reference: "ful_1", fulfillment_id: null, waybills: ["w"] }), { packageReference: "ful_1" })
  assert.deepEqual(labelSearchOf({ reference: null, fulfillment_id: null, waybills: ["w"] }), { waybills: ["w"] })
  assert.equal(labelSearchOf({ reference: null, fulfillment_id: null, waybills: null }), null)
})

/** A client paced at one call a minute: after one call, the next is refused by the pacing and never sent. */
async function paced(state: "pending" | "failed" = "pending") {
  const fake = new FakeDpdServices()
  const s = setup(WRITING, [courierOrder()], { fake, requestsPerMinute: 1 })
  arm(s, "shipment")
  const row = await recordFulfillment(s.container, ORDER, FUL)
  assert.ok(row)
  const id = String(row.id)
  rowOf(s, id).state = state
  const { plan } = await planForShipment(s.container, id)
  return { s, fake, id, hash: plan.hash, client: s.container.resolve<DpdServicesClient>("dpdServicesClient") }
}

test("the pacing sent nothing: the row goes back to where it was claimed from, rate_limited_manual for a click, create_deferred and never create_sent", async () => {
  for (const state of ["pending", "failed"] as const) {
    const { s, fake, id, hash, client } = await paced(state)
    await client.generateSpedLabels(labelsRequest({ packageReference: "warm-up" }, "A4"))
    const row = await createShipment(s.container, id, manual(hash))
    assert.equal(row.state, state, `back to ${state}`)
    assert.equal(row.error_code, "rate_limited_manual", "a person asked: the pass does not send it later")
    assert.equal(row.attempts, 0, "a claim that sent nothing is not counted")
    assert.equal(row.claim_token, null)
    assert.equal(fake.count("numbers"), 0, "nothing left this server")
    assert.deepEqual(actions(s, id), ["recorded", "create_deferred"], "no create_sent for a request that never left")
    assert.equal(row.references, null, "no attempt in the references history")
  }
})

test("the pacing holds the label back: created, rate_limited, label_deferred, not counted as asked", async () => {
  const { s, fake, id, hash } = await paced()
  const row = await createShipment(s.container, id, manual(hash))
  assert.equal(fake.count("numbers"), 1)
  assert.equal(fake.count("labels"), 0)
  assert.equal(row.state, "created")
  assert.equal(row.error_code, "rate_limited", "chained to the create: the pass asks for the label again")
  assert.equal(row.attempts, 1, "the create claim only: the label claim sent nothing")
  assert.deepEqual(actions(s, id), ["recorded", "create_sent", "created", "label_deferred"])
  const again = await labelAttempt(s.container, id, { actor: ADMIN, trigger: "manual" })
  assert.equal(again.asked, false)
  assert.equal(again.row.state, "created")
  assert.equal(again.row.error_code, "rate_limited_manual", "a person asked: a person asks again")
  assert.equal(again.row.attempts, 1)
})

/* Stage 3: DPD Pickup (spec 8, 9.3, DS13). */

const PICKUP = { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL14509", dpd_country: "PL" }

function pickupOrder(items: Row[] = [{ id: "li_1", quantity: 1, variant: { weight: 1500 } }], data: Row = PICKUP): Row {
  return order({
    id: ORDER,
    items,
    shipping_methods: [{ id: "sm_01", name: "DPD Pickup", shipping_option_id: "so_01", data }],
    fulfillments: [{ id: FUL, provider_id: "dpd_dpd", data, canceled_at: null }],
  })
}

type PickupReady = Ready & { points: CountingPoints }

async function pickupReady(opts: { orders?: Row[]; fake?: FakeDpdServices } = {}): Promise<PickupReady> {
  const fake = opts.fake ?? new FakeDpdServices()
  const points = countingPoints(catalogSource("sandbox", SANDBOX_POINTS))
  const s = setup(WRITING, opts.orders ?? [pickupOrder()], { fake, points })
  arm(s, "shipment")
  const row = await recordFulfillment(s.container, ORDER, FUL)
  assert.ok(row)
  const { plan } = await planForShipment(s.container, String(row.id))
  return { s, fake, id: String(row.id), hash: plan.hash, points }
}

const codesOf = (v: unknown) => problemsOf(v).map((p) => p.code)

test("Pickup: one numbers call with the point and the recipient of the point, labeled, the service stored", async () => {
  const { s, fake, id, hash } = await pickupReady()
  const row = await createShipment(s.container, id, manual(hash))
  assert.equal(row.state, "labeled")
  assert.equal(row.service, "pickup")
  assert.equal(fake.count("numbers"), 1)
  const body = fake.calls.find((c) => c.op === "numbers")?.body as { packages: Array<Row & { pudoReceiver?: Row; services?: Array<Row & { attributes?: Row[] }> }> }
  const pkg = body.packages[0]
  assert.ok(pkg?.pudoReceiver, "the recipient of the point")
  const pudo = pkg?.services?.find((x) => x.code === "DPD_PICKUP")
  assert.deepEqual(pudo?.attributes, [{ code: "PUDO", value: "PL14509" }])
})

test("Pickup refused before anything is sent: two boxes, a point the catalog does not know", async () => {
  const two = await pickupReady()
  rowOf(two.s, two.id).boxes = { edited: true, items: [1, 2].map((n) => ({ weightKg: n, lengthCm: null, widthCm: null, heightCm: null, reference: null, waybill: null })) }
  const { plan } = await planForShipment(two.s.container, two.id)
  await refusedWith(createShipment(two.s.container, two.id, manual(plan.hash)), 422, "plan_problems")
  assert.deepEqual(codesOf(rowOf(two.s, two.id).problems), ["multi_box_not_allowed"])
  const unknown = await pickupReady({ orders: [pickupOrder(undefined, { ...PICKUP, dpd_pudo_id: "PL0SBX99" })] })
  await refusedWith(createShipment(unknown.s.container, unknown.id, manual(unknown.hash)), 422, "plan_problems")
  assert.deepEqual(codesOf(rowOf(unknown.s, unknown.id).problems), ["pudo_not_found"])
  assert.equal(two.fake.calls.length + unknown.fake.calls.length, 0)
})

test("a point nobody could check is sent by hand; the answer of DPD about it is kept with its source, next to the warning of the plan", async () => {
  const { s, fake, id, points } = await pickupReady({ fake: new FakeDpdServices({ pudoIds: [] }) })
  points.fail.details = "timeout"
  const { plan } = await planForShipment(s.container, id)
  assert.equal(plan.ok, true, "unchecked is a warning, never a problem")
  assert.ok(plan.warnings.some((w) => w.code === "pudo_unchecked"))
  const row = await createShipment(s.container, id, manual(plan.hash))
  assert.equal(fake.count("numbers"), 1, "a manual create sends")
  assert.equal(row.state, "failed")
  const problems = problemsOf(row.problems)
  assert.deepEqual(problems.map((p) => p.code), ["pudo_not_found"], "the point answer only, without the receiver codes DPD lists before it")
  assert.equal(problems[0]?.source, "dpd")
  assert.equal(toShipmentDto(row).problems?.[0]?.source, "dpd")
  const again = await planForShipment(s.container, id)
  assert.ok(again.plan.warnings.some((w) => w.code === "pudo_unchecked"))
  assert.deepEqual(codesOf(again.row.problems), ["pudo_not_found"], "the plan does not wash the answer of DPD away")
  assert.equal(problemsOf(again.row.problems)[0]?.source, "dpd")
})

test("the source of a problem: only dpd is kept; mergeProblems keeps the answers of DPD on a failed row and drops the point ones on request", () => {
  assert.deepEqual(problemsOf([{ code: "a", source: "dpd" }, { code: "b", source: "plan" }, { code: "c", source: 1 }]), [{ code: "a", source: "dpd" }, { code: "b" }, { code: "c" }])
  const stored = [{ code: "pudo_not_found", field: "INCORRECT_PUDO", detail: "PL14509", source: "dpd" }, { code: "dpd_validation", field: "x" }]
  assert.deepEqual(codesOf(mergeProblems([], stored, "failed")), ["pudo_not_found", "dpd_validation"])
  assert.equal(problemsOf(mergeProblems([], stored, "failed"))[0]?.source, "dpd")
  assert.deepEqual(codesOf(mergeProblems([], stored, "failed", { dropPointAnswers: true })), ["dpd_validation"])
  assert.equal(mergeProblems([], stored, "pending"), null)
  assert.deepEqual(codesOf(mergeProblems([{ code: "pudo_not_found", field: "pudoId", detail: "PL14509" }], stored, "failed")), ["pudo_not_found", "dpd_validation"], "the finding of the plan is not doubled")
})

test("autoCreate never sends to a point nobody could check (DS13): pending with point_unchecked, one history line; once checked, it sends", async () => {
  const { s, fake, id, points } = await pickupReady()
  points.fail.details = "network"
  for (let n = 0; n < 2; n += 1) {
    const r = await createAttempt(s.container, id, { actor: "system", trigger: "auto" })
    assert.equal(r.sent, false)
  }
  assert.equal(fake.calls.length, 0, "zero calls to DPD")
  const row = rowOf(s, id)
  assert.equal(row.state, "pending")
  assert.equal(row.error_code, "point_unchecked")
  assert.equal(row.attempts, 0)
  assert.equal(actions(s, id).filter((a) => a === "create_deferred").length, 1, "one line over two runs")
  assert.match(String(s.events.rows.find((e) => (e.data as Row | null)?.action === "create_deferred")?.message), /PL14509.*network/)
  points.fail.details = undefined
  const sent = await createAttempt(s.container, id, { actor: "system", trigger: "auto" })
  assert.equal(sent.sent, true)
  assert.equal(sent.row.state, "labeled")
  assert.equal(sent.row.error_code, null)
  assert.equal(fake.count("numbers"), 1)

  const byHand = await pickupReady()
  byHand.points.fail.details = "timeout"
  const { plan } = await planForShipment(byHand.s.container, byHand.id)
  assert.equal((await createShipment(byHand.s.container, byHand.id, manual(plan.hash))).state, "labeled", "by hand it goes, DPD checks the point")
})

/* Stage 5: dpd.shipment.created (DS11, 6.14). */

const createdEvents = (s: Setup) => s.emitted.filter((e) => e.name === "dpd.shipment.created")

test("dpd.shipment.created once per row: a lost finish and a second adoption emit nothing", async () => {
  const { s, id, hash } = await ready()
  const row = await createShipment(s.container, id, manual(hash))
  assert.equal(row.state, "labeled")
  const [created] = createdEvents(s)
  assert.ok(created)
  assert.equal(created.data.id, id)
  assert.equal(created.data.stage, "preparing")
  assert.equal(created.data.previous_stage, null)
  assert.equal(created.data.event_id, null)
  assert.deepEqual(created.data.waybills, row.waybills)
  await refusedWith(createShipment(s.container, id, manual(hash)), 409, "wrong_state")
  assert.equal(createdEvents(s).length, 1)

  /* The finish loses its claim (another process took the row): nothing emitted. */
  const lost = await ready()
  const finish = lost.s.store.finish
  lost.s.store.finish = async (...args) => {
    rowOf(lost.s, lost.id).claim_token = "token_of_another_process"
    return finish.apply(lost.s.store, args)
  }
  const after = await createShipment(lost.s.container, lost.id, manual(lost.hash))
  assert.notEqual(after.state, "labeled")
  assert.equal(createdEvents(lost.s).length, 0)

  /* An adopted duplicate emits once; the next create is refused and emits nothing. */
  const same = new FakeDpdServices()
  same.seedPackage(FUL, 1)
  const one = await ready({ fake: same })
  assert.equal((await createShipment(one.s.container, one.id, manual(one.hash))).error_code, "adopted")
  await refusedWith(createShipment(one.s.container, one.id, manual(one.hash)), 409, "wrong_state")
  assert.equal(createdEvents(one.s).length, 1)

  /* An ambiguous takeover emits nothing until a person accepts it. */
  const more = new FakeDpdServices()
  more.seedPackage(FUL, 2)
  const two = await ready({ fake: more })
  assert.equal((await createShipment(two.s.container, two.id, manual(two.hash))).state, "ambiguous")
  assert.equal(createdEvents(two.s).length, 0)
  await acceptShipment(two.s.container, two.id, ADMIN)
  await refusedWith(acceptShipment(two.s.container, two.id, ADMIN), 409, "wrong_state")
  assert.equal(createdEvents(two.s).length, 1)
})
