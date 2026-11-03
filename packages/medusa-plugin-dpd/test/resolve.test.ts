/**
 * What is unclear, resolved: the lookup of an unknown row by its reference
 * (only after it settled, never for a row with waybills), a canceled
 * fulfillment that keeps an unclear row apart, and the periodic pass:
 * old documents removed, leases taken back, unclear rows looked up, and
 * with autoCreate only the rows recorded after the writer was armed and
 * within the age window created; the labels that did not come asked for
 * again, never for a canceled fulfillment. Fake DPDServices, memory store,
 * no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { AUTO_LABEL_MAX_ATTEMPTS, CREATE_LEASE_MS, DPDSERVICES_PATHS, UNKNOWN_SETTLE_MS } from "../src/modules/dpd/lib/constants.ts"
import { createShipment, labelAttempt } from "../src/workflows/dpd/create.ts"
import { createDpdServicesClient, labelsRequest } from "../src/modules/dpd/lib/dpdservices.ts"
import { planForShipment } from "../src/workflows/dpd/plan.ts"
import { lookupShipment, runShipmentPass } from "../src/workflows/dpd/resolve.ts"
import { onFulfillmentCanceled, recordFulfillment } from "../src/workflows/dpd/shipments.ts"
import dpdSyncShipments, { config as jobConfig } from "../src/jobs/dpd-sync-shipments.ts"
import type { DpdPluginOptions } from "../src/modules/dpd/lib/options.ts"
import { catalogSource, SANDBOX_POINTS, type PointsSource } from "../src/modules/dpd/lib/points.ts"
import { FakeDpdServices, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"
import { PROTOCOL_LEASE_MS } from "../src/modules/dpd/lib/constants.ts"
import { createDispatch, planDispatch } from "../src/workflows/dpd/dispatch.ts"
import { arm, countingPoints, insertLabeled, labeledOrder, order, SANDBOX, setup, type Container, type Row, type Setup } from "./helpers.ts"

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
const ADMIN = "user_01ADMIN"
const WRITING: DpdPluginOptions = { ...SANDBOX, shipmentWriter: true }
const COURIER = { dpd_option: "dpd-courier", dpd_kind: "courier", dpd_cod: false, dpd_country: "PL" }
const LATER = () => new Date(Date.now() + UNKNOWN_SETTLE_MS + 1000)

function courierOrder(id = ORDER, ful = FUL, fulfillment: Row = {}): Row {
  return order({
    id,
    items: [{ id: `li_${id}`, quantity: 2, variant: { weight: 1200 } }],
    fulfillments: [{ id: ful, provider_id: "dpd_dpd", data: COURIER, canceled_at: null, ...fulfillment }],
  })
}

function rowOf(s: Setup, id: string): Row {
  const row = s.shipments.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

async function refusedWith(work: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(work, (err: unknown) => {
    const e = err as { status?: number; code?: string }
    assert.equal(e.status, status)
    assert.equal(e.code, code)
    return true
  })
}

/** A row left unknown by a create whose answer was lost (or timed out). */
async function unknownRow(failure: "lose_answer" | "timeout", options: DpdPluginOptions = WRITING, orders: Row[] = [courierOrder()]) {
  const fake = new FakeDpdServices()
  const s = setup(options, orders, { fake })
  arm(s, "shipment")
  const row = await recordFulfillment(s.container, ORDER, FUL)
  const id = String(row?.id)
  fake.failNext("numbers", failure)
  const { plan } = await planForShipment(s.container, id)
  assert.equal((await createShipment(s.container, id, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).state, "unknown")
  return { s, fake, id }
}

test("lookup: only after the row settled; a lost answer is found and adopted with its label", async () => {
  const { s, fake, id } = await unknownRow("lose_answer")
  await refusedWith(lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual" }), 409, "too_early")
  assert.equal((await lookupShipment(s.container, id, { actor: "system", trigger: "auto" })).state, "unknown", "the pass waits silently")
  assert.equal(fake.count("labels"), 0)

  const row = await lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(row.state, "labeled")
  assert.equal(row.error_code, "adopted")
  assert.deepEqual(row.waybills, fake.packages.get(FUL)?.parcels.map((p) => p.waybill))
  assert.equal(fake.count("numbers"), 1, "never sent again")
  assert.equal(s.documents.rows.length, 1)
  assert.deepEqual(s.fulfillments.get(FUL)?.data?.dpd_waybills, row.waybills)
  assert.deepEqual(s.events.rows.at(-1)?.data, { action: "lookup", outcome: "adopted", state: "labeled", trigger: "manual", traceId: "fake-trace-2" }, "the trace of the labels call (the lost numbers answer had the first)")
  await refusedWith(lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: LATER() }), 409, "wrong_state")
})

test("lookup: not found goes back to pending with fresh problems; an unclear lookup stays unknown; a row with waybills is refused (E4)", async () => {
  const { s, fake, id } = await unknownRow("timeout")
  fake.failNext("labels", { status: 503, text: "busy" })
  const still = await lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(still.state, "unknown")
  assert.equal(still.error_code, "lookup_failed")
  const back = await lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(back.state, "pending")
  assert.equal(back.error_code, "not_created")
  assert.equal(back.problems, null, "the plan is clean again")
  assert.equal(back.claim_token, null)
  const { plan } = await planForShipment(s.container, id)
  const created = await createShipment(s.container, id, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })
  assert.equal(created.state, "labeled", "created again with the same reference")
  assert.equal(created.reference, FUL)

  rowOf(s, id).state = "unknown"
  await refusedWith(lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: LATER() }), 409, "wrong_state")
})

test("lookup needs the armed writer, like every call that advises parcels", async () => {
  const { s, fake, id } = await unknownRow("timeout")
  arm(s, "shipment", false)
  await refusedWith(lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: LATER() }), 409, "not_armed")
  assert.equal(fake.count("labels"), 0)
})

test("a fulfillment canceled while the answer was unclear: abandoned_unknown, then canceled when DPD has nothing, kept apart when it has", async () => {
  const none = await unknownRow("timeout")
  const abandoned = await onFulfillmentCanceled(none.s.container, FUL)
  assert.equal(abandoned?.state, "abandoned_unknown")
  assert.equal((none.s.events.rows.at(-1)?.data as Row).action, "abandoned")
  assert.equal(none.s.events.rows.at(-1)?.dedupe_key, `fulfillment_canceled:${none.id}`)
  assert.equal((await onFulfillmentCanceled(none.s.container, FUL))?.state, "abandoned_unknown", "idempotent")
  const canceled = await lookupShipment(none.s.container, none.id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(canceled.state, "canceled")

  const some = await unknownRow("lose_answer")
  await onFulfillmentCanceled(some.s.container, FUL)
  const found = await lookupShipment(some.s.container, some.id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(found.state, "abandoned_unknown")
  assert.equal(found.error_code, "abandoned_found")
  assert.equal((found.waybills as string[]).length, 1, "the waybills, to exclude them from the handover")
  assert.equal(some.s.fulfillments.get(FUL)?.data?.dpd_waybills, undefined, "a canceled fulfillment is not noted")
  await refusedWith(lookupShipment(some.s.container, some.id, { actor: ADMIN, trigger: "manual", now: LATER() }), 409, "wrong_state")

  const failing = await unknownRow("timeout")
  await onFulfillmentCanceled(failing.s.container, FUL)
  failing.fake.failNext("labels", "network")
  assert.equal((await lookupShipment(failing.s.container, failing.id, { actor: ADMIN, trigger: "manual", now: LATER() })).state, "abandoned_unknown", "E5: an unclear lookup keeps it apart")
})

test("the pass: leases that ran out are taken back with a history line, unclear rows are looked up once settled", async () => {
  const { s, fake, id } = await unknownRow("lose_answer")
  /* A second row stuck in creating, its lease over. */
  const other = await s.store.insertIgnore({
    order_id: ORDER,
    display_id: 1042,
    fulfillment_id: "ful_other",
    return_id: null,
    kind: "outbound",
    mode: "sandbox",
    option_id: "dpd-courier",
    service: null,
    pudo_id: null,
    country_code: "PL",
    session_type: null,
    cod_minor: null,
    currency: "PLN",
    reference: "ful_other",
    state: "pending",
    problems: null,
  })
  await s.store.claim(String(other?.id), ["pending"], { token: "lost", leaseUntil: new Date(Date.now() - 1000), to: "creating" })

  const first = await runShipmentPass(s.container)
  assert.equal(first.ran, true)
  assert.equal(first.expired, 1)
  assert.equal(rowOf(s, String(other?.id)).state, "unknown")
  assert.equal(rowOf(s, String(other?.id)).error_code, "lease_expired")
  assert.ok(s.events.rows.some((e) => e.shipment_id === other?.id && (e.data as Row).action === "lease_expired"))
  assert.equal(first.lookedUp, 0, "not settled yet")
  assert.equal(fake.count("labels"), 0)

  const later = await runShipmentPass(s.container, LATER())
  assert.equal(later.lookedUp, 2)
  assert.equal(rowOf(s, id).state, "labeled", "found and adopted")
  assert.equal(rowOf(s, String(other?.id)).state, "pending", "nothing under its reference")
  assert.equal(fake.count("numbers"), 1, "the pass never creates without autoCreate")
})

test("the pass with autoCreate: only rows recorded after the writer was armed and within the age window, newest first, problems excluded", async () => {
  const orders = ["1", "2", "3", "4"].map((n) => courierOrder(`order_0${n}`, `ful_0${n}`))
  orders[3] = order({ id: "order_04", fulfillments: [{ id: "ful_04", provider_id: "dpd_dpd", data: COURIER, canceled_at: null }] })
  const fake = new FakeDpdServices()
  const s = setup({ ...WRITING, autoCreate: true, autoCreateMaxAgeHours: 2 }, orders, { fake })
  const rows: Row[] = []
  for (const n of ["1", "2", "3", "4"]) rows.push((await recordFulfillment(s.container, `order_0${n}`, `ful_0${n}`)) as Row)
  assert.equal(fake.calls.length, 0, "not armed: recording sends nothing")
  arm(s, "shipment")
  const now = Date.now()
  const armedAt = s.settings.rows.find((r) => String(r.key).endsWith("writer:shipment"))
  assert.ok(armedAt)
  armedAt.updated_at = new Date(now - 60 * 60_000)
  const at = (row: Row, minutesAgo: number) => void (rowOf(s, String(row.id)).created_at = new Date(now - minutesAgo * 60_000))
  at(rows[0], 90) /* before the writer was armed */
  at(rows[1], 30)
  at(rows[2], 10)
  at(rows[3], 5) /* weight_missing */

  const pass = await runShipmentPass(s.container)
  assert.equal(pass.created, 2)
  assert.equal(rowOf(s, String(rows[0].id)).state, "pending", "recorded before the writer was armed: never sent by itself")
  assert.equal(rowOf(s, String(rows[1].id)).state, "labeled")
  assert.equal(rowOf(s, String(rows[2].id)).state, "labeled")
  assert.equal(rowOf(s, String(rows[3].id)).state, "pending", "a row with problems waits for a person")
  const refs = fake.calls.filter((c) => c.op === "numbers").map((c) => (c.body as { packages: Array<{ reference: string }> }).packages[0].reference)
  assert.deepEqual(refs, ["ful_03", "ful_02"], "newest first (E11)")
  assert.equal(s.events.rows.find((e) => (e.data as Row | null)?.action === "create_sent")?.source, "system")

  armedAt.updated_at = new Date(now - 10 * 3_600_000)
  at(rows[0], 3 * 60)
  assert.equal((await runShipmentPass(s.container)).created, 0, "older than the window")
})

test("the pass asks again for the labels that did not come, never for a canceled fulfillment (E12)", async () => {
  const fake = new FakeDpdServices()
  const s = setup({ ...WRITING, autoCreate: true }, [courierOrder()], { fake })
  arm(s, "shipment")
  const row = (await recordFulfillment(s.container, ORDER, FUL)) as Row
  const id = String(row.id)
  fake.failNext("labels", "timeout")
  const { plan } = await planForShipment(s.container, id)
  assert.equal((await createShipment(s.container, id, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).error_code, "label_unclear")

  const canceled = s.orders.get(ORDER) as Row
  ;(canceled.fulfillments as Row[])[0].canceled_at = new Date()
  assert.equal((await runShipmentPass(s.container)).labeled, 0, "a skipped row is not counted as asked again")
  assert.equal(rowOf(s, id).state, "created", "skipped: the parcel will not go")
  assert.equal(fake.count("labels"), 1)

  ;(canceled.fulfillments as Row[])[0].canceled_at = null
  assert.equal((await runShipmentPass(s.container)).labeled, 1)
  assert.equal(rowOf(s, id).state, "labeled")
  assert.equal(fake.count("labels"), 2)
})

test("the pass asks again for a label only within the age window and up to AUTO_LABEL_MAX_ATTEMPTS claims", async () => {
  const fake = new FakeDpdServices()
  const s = setup({ ...WRITING, autoCreate: true, autoCreateMaxAgeHours: 2 }, [courierOrder()], { fake })
  arm(s, "shipment")
  const armedAt = s.settings.rows.find((r) => String(r.key).endsWith("writer:shipment"))
  assert.ok(armedAt)
  armedAt.updated_at = new Date(Date.now() - 10 * 3_600_000)
  const id = String(((await recordFulfillment(s.container, ORDER, FUL)) as Row).id)
  fake.failNext("labels", "timeout")
  const { plan } = await planForShipment(s.container, id)
  assert.equal((await createShipment(s.container, id, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).error_code, "label_unclear")
  assert.equal(fake.count("labels"), 1)

  rowOf(s, id).created_at = new Date(Date.now() - 3 * 3_600_000)
  assert.equal((await runShipmentPass(s.container)).labeled, 0, "older than autoCreateMaxAgeHours: a person asks")
  rowOf(s, id).created_at = new Date()
  rowOf(s, id).attempts = AUTO_LABEL_MAX_ATTEMPTS + 1
  assert.equal((await runShipmentPass(s.container)).labeled, 0, "claimed too many times: a person asks")
  assert.equal(fake.count("labels"), 1, "nothing sent for either")

  rowOf(s, id).attempts = AUTO_LABEL_MAX_ATTEMPTS
  assert.equal((await runShipmentPass(s.container)).labeled, 1)
  assert.equal(rowOf(s, id).state, "labeled")
})

test("the pass sends again what the pacing held back: a failed rate_limited row is created, a rate_limited label asked again", async () => {
  const fake = new FakeDpdServices()
  const s = setup({ ...WRITING, autoCreate: true }, [courierOrder(), courierOrder("order_02", "ful_02")], { fake })
  arm(s, "shipment")
  const held = String(((await recordFulfillment(s.container, ORDER, FUL)) as Row).id)
  Object.assign(rowOf(s, held), { state: "failed", error_code: "rate_limited", error: "Too many DPD calls from this server." })
  const other = String(((await recordFulfillment(s.container, "order_02", "ful_02")) as Row).id)
  Object.assign(rowOf(s, other), { state: "failed", error_code: "incorrect_data" })

  const pass = await runShipmentPass(s.container)
  assert.equal(pass.created, 1)
  assert.equal(rowOf(s, held).state, "labeled", "nothing reached DPD before: sent now")
  assert.equal(rowOf(s, other).state, "failed", "a refusal of DPD waits for a person")

  const { plan } = await planForShipment(s.container, other)
  rowOf(s, other).state = "pending"
  fake.failNext("labels", { status: 429 })
  assert.equal((await createShipment(s.container, other, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).error_code, "rate_limited")
  assert.equal((await runShipmentPass(s.container)).labeled, 1, "rate_limited is a label code the pass retries")
  assert.equal(rowOf(s, other).state, "labeled")
})

test("lookup: the lease runs from the claim, not from the clock given for the settle check", async () => {
  const fake = new FakeDpdServices()
  let leaseSeen: unknown = null
  let shipments: Row[] = []
  const inner = fake.fetch
  fake.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith(DPDSERVICES_PATHS.labels)) leaseSeen = shipments.find((r) => r.state === "creating")?.lease_until ?? null
    return inner(input, init)
  }
  const s = setup(WRITING, [courierOrder()], { fake })
  shipments = s.shipments.rows
  arm(s, "shipment")
  const id = String(((await recordFulfillment(s.container, ORDER, FUL)) as Row).id)
  fake.failNext("numbers", "timeout")
  const { plan } = await planForShipment(s.container, id)
  assert.equal((await createShipment(s.container, id, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).state, "unknown")
  const far = new Date(Date.now() + 10 * 3_600_000)
  const before = Date.now()
  await lookupShipment(s.container, id, { actor: ADMIN, trigger: "manual", now: far })
  assert.ok(leaseSeen instanceof Date, "the row was claimed while DPD was asked")
  assert.ok(leaseSeen.getTime() <= Date.now() + CREATE_LEASE_MS, "not the far clock plus the lease")
  assert.ok(leaseSeen.getTime() >= before + CREATE_LEASE_MS)
})

test("lookup: DPD answers OK without a single waybill: ambiguous for a person, never abandoned_unknown without waybills", async () => {
  const empty = { status: 200, body: { status: "OK", documentData: TINY_PDF_BASE64, documentId: null, session: { statusInfo: { status: "OK" }, packages: [] } } }
  const live = await unknownRow("timeout")
  live.fake.failNext("labels", empty)
  const one = await lookupShipment(live.s.container, live.id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(one.state, "ambiguous")
  assert.equal(one.error_code, "waybill_count_mismatch")
  assert.deepEqual(one.waybills, [])

  const gone = await unknownRow("timeout")
  await onFulfillmentCanceled(gone.s.container, FUL)
  gone.fake.failNext("labels", empty)
  const two = await lookupShipment(gone.s.container, gone.id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(two.state, "ambiguous", "a canceled fulfillment too: nothing to exclude, a person checks")
  assert.equal(two.error_code, "waybill_count_mismatch")
})

test("the pass: many abandoned rows DPD already found never hide a row that still needs a lookup", async () => {
  const { s, id } = await unknownRow("lose_answer")
  const old = new Date(Date.now() - 3_600_000)
  for (let i = 0; i < 205; i += 1) {
    s.shipments.insert({
      order_id: `order_ab_${i}`,
      fulfillment_id: `ful_ab_${i}`,
      kind: "outbound",
      mode: "sandbox",
      option_id: "dpd-courier",
      reference: `ful_ab_${i}`,
      state: "abandoned_unknown",
      waybills: [`0000899${String(900000 + i)}Q`],
      error_code: "abandoned_found",
      problems: null,
      created_at: old,
      updated_at: old,
    })
  }
  const pass = await runShipmentPass(s.container, LATER())
  assert.equal(pass.lookedUp, 1)
  assert.equal(rowOf(s, id).state, "labeled")
})

test("the pass counts only the lookups that asked DPD: a row that changed after the listing waits", async () => {
  const { s, fake, id } = await unknownRow("lose_answer")
  rowOf(s, id).updated_at = new Date(Date.now() - 10 * 60_000)
  const dpd = s.container.resolve<{ listDpdShipments: (f?: Row, c?: { order?: Row }) => Promise<Row[]> }>("dpd")
  const list = dpd.listDpdShipments
  dpd.listDpdShipments = async (f, c) => {
    const rows = await list(f, c)
    /* Another process touches the row between the listing and the lookup. */
    if (c?.order?.updated_at === "ASC") rowOf(s, id).updated_at = new Date()
    return rows
  }
  const pass = await runShipmentPass(s.container)
  assert.equal(pass.lookedUp, 0)
  assert.equal(rowOf(s, id).state, "unknown")
  assert.equal(fake.count("labels"), 0)
})

test("the pass removes old documents also while DPD is not configured (no DPD call)", async () => {
  const s = setup({ shipmentWriter: true, documentRetentionDays: 30 }, [])
  s.documents.insert({ shipment_id: "dpdshp_x", type: "label", data: "old", mode: s.options.mode, created_at: new Date(Date.now() - 31 * 86_400_000) })
  s.documents.insert({ shipment_id: "dpdshp_x", type: "label", data: "new", mode: s.options.mode, created_at: new Date(Date.now() - 29 * 86_400_000) })
  assert.deepEqual(await runShipmentPass(s.container), { purged: 1, expired: 0, dispatchesExpired: 0, lookedUp: 0, created: 0, labeled: 0, ran: false })
  assert.deepEqual(s.documents.rows.map((d) => d.data), ["new"])
})

test("the pass removes documents older than the retention (E10), waits while DPD is not configured, and runs once at a time", async () => {
  const s = setup({ ...WRITING, documentRetentionDays: 30 }, [], { fake: new FakeDpdServices() })
  s.documents.insert({ shipment_id: "dpdshp_x", type: "label", data: "x", mode: "sandbox", created_at: new Date(Date.now() - 31 * 86_400_000) })
  s.documents.insert({ shipment_id: "dpdshp_x", type: "label", data: "y", mode: "sandbox", created_at: new Date(Date.now() - 29 * 86_400_000) })
  s.documents.insert({ shipment_id: "dpdshp_y", type: "label", data: "z", mode: "live", created_at: new Date(Date.now() - 400 * 86_400_000) })
  const [one, two] = await Promise.all([runShipmentPass(s.container), runShipmentPass(s.container)])
  assert.equal(one.purged, 1)
  assert.equal(two.ran, false, "the second pass of the same process waits for the next tick")
  assert.deepEqual(s.documents.rows.map((d) => d.data).sort(), ["y", "z"], "another mode is not touched")

  const bare = setup({ shipmentWriter: true }, [])
  assert.deepEqual(await runShipmentPass(bare.container), { purged: 0, expired: 0, dispatchesExpired: 0, lookedUp: 0, created: 0, labeled: 0, ran: false })

  assert.equal(jobConfig.name, "dpd-sync-shipments")
  assert.equal(jobConfig.schedule, "*/5 * * * *")
  await dpdSyncShipments(s.container as never)
})

/* ------------------------------------------------------------------ */
/* The pacing: what never left is no attempt and no pass result        */
/* ------------------------------------------------------------------ */

/**
 * The container of `s` with a switch: while `paced.on`, the DPD client is
 * one whose pacing refuses every call (one call a minute, already used by a
 * warm-up labels call), so nothing reaches the fake.
 */
async function withPacing(s: Setup): Promise<{ container: Container; paced: { on: boolean } }> {
  const fake = s.fake
  assert.ok(fake)
  const slow = createDpdServicesClient({ host: fake.host, login: fake.login, password: fake.password, masterFid: 1000, requestsPerMinute: 1, fetchImpl: fake.fetch, sleep: async () => {} })
  await slow.generateSpedLabels(labelsRequest({ packageReference: "warm-up" }, "A4"))
  const paced = { on: true }
  const container: Container = {
    resolve: <T = unknown>(key: string, opts?: { allowUnregistered?: boolean }): T =>
      paced.on && key === "dpdServicesClient" ? (slow as unknown as T) : s.container.resolve<T>(key, opts),
  }
  return { container, paced }
}

/** Rows recorded with the writer off (nothing created in the background), then the writer armed an hour ago. */
async function autoSetup(orders: Row[], fake = new FakeDpdServices()) {
  const s = setup({ ...WRITING, autoCreate: true }, orders, { fake })
  const ids: string[] = []
  for (const o of orders) ids.push(String(((await recordFulfillment(s.container, String(o.id), String((o.fulfillments as Row[])[0].id))) as Row).id))
  arm(s, "shipment")
  const armed = s.settings.rows.find((r) => String(r.key).endsWith("writer:shipment"))
  assert.ok(armed)
  armed.updated_at = new Date(Date.now() - 3_600_000)
  for (const id of ids) rowOf(s, id).created_at = new Date(Date.now() - 60_000)
  return { s, fake, ids }
}

function actionsOf(s: Setup, id: string): string[] {
  return s.events.rows.filter((e) => e.shipment_id === id).map((e) => String((e.data as Row | null)?.action ?? ""))
}

test("a row the pacing held back 4 times is not counted as created, keeps attempts 0, and is still created and labeled by the pass", async () => {
  const { s, fake, ids } = await autoSetup([courierOrder()])
  const [id] = ids
  const { container, paced } = await withPacing(s)
  for (let n = 0; n < 4; n += 1) {
    const pass = await runShipmentPass(container)
    assert.equal(pass.created, 0, "nothing left this server: not created")
    assert.equal(rowOf(s, id).state, "pending")
    assert.equal(rowOf(s, id).error_code, "rate_limited", "held back from the pass: the pass sends it again")
    assert.equal(rowOf(s, id).attempts, 0, "a claim that sent nothing is not counted")
  }
  assert.equal(fake.count("numbers"), 0)
  assert.deepEqual(actionsOf(s, id), ["recorded", "create_deferred", "create_deferred", "create_deferred", "create_deferred"])

  paced.on = false
  fake.failNext("labels", "timeout")
  const pass = await runShipmentPass(container)
  assert.equal(pass.created, 1)
  assert.equal(pass.labeled, 1, "the label that did not come is asked again in the same pass: 2 claims, within AUTO_LABEL_MAX_ATTEMPTS")
  assert.equal(rowOf(s, id).state, "labeled")
  assert.equal(rowOf(s, id).attempts, 3, "the create, the label that timed out and the label that came")
  assert.equal(fake.count("numbers"), 1)
})

test("a paced lookup sent nothing: not counted as looked up, the row goes back as it was (state, error, attempts, settle clock)", async () => {
  const { s, fake, id } = await unknownRow("timeout")
  const before = { ...rowOf(s, id) }
  assert.equal(before.state, "unknown")
  const { container, paced } = await withPacing(s)
  const labelsBefore = fake.count("labels")

  const pass = await runShipmentPass(container, LATER())
  assert.equal(pass.lookedUp, 0, "nothing asked: not looked up")
  const row = rowOf(s, id)
  assert.equal(row.state, "unknown")
  assert.equal(row.error_code, before.error_code, "not lookup_failed: DPD was never asked")
  assert.equal(row.error, before.error)
  assert.equal(row.attempts, before.attempts)
  assert.equal(row.claim_token, null)
  assert.equal((row.updated_at as Date).getTime(), (before.updated_at as Date).getTime(), "the settle clock is not restarted")
  assert.equal(fake.count("labels"), labelsBefore)
  assert.equal(actionsOf(s, id).at(-1), "lookup_deferred")

  const manual = await lookupShipment(container, id, { actor: ADMIN, trigger: "manual", now: LATER() })
  assert.equal(manual.state, "unknown")
  assert.equal(manual.error_code, "rate_limited_manual", "the person sees why nothing happened")
  assert.equal(manual.attempts, before.attempts)

  paced.on = false
  const found = await runShipmentPass(container, LATER())
  assert.equal(found.lookedUp, 1, "an unclear row is still looked up by the pass")
  assert.equal(rowOf(s, id).state, "pending")
  assert.equal(rowOf(s, id).error_code, "not_created")
})

test("a click the pacing held back stays with the person: rate_limited_manual is never created or labeled by the pass", async () => {
  const { s, fake, ids } = await autoSetup([courierOrder(), courierOrder("order_02", "ful_02"), courierOrder("order_03", "ful_03")])
  const [pending, failed, label] = ids
  rowOf(s, failed).state = "failed"
  const { container, paced } = await withPacing(s)
  for (const id of [pending, failed]) {
    const { plan } = await planForShipment(container, id)
    const row = await createShipment(container, id, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })
    assert.equal(row.error_code, "rate_limited_manual")
    assert.equal(row.attempts, 0)
  }
  paced.on = false
  fake.failNext("labels", "timeout")
  const { plan } = await planForShipment(s.container, label)
  assert.equal((await createShipment(s.container, label, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).error_code, "label_unclear")
  paced.on = true
  const held = await labelAttempt(container, label, { actor: ADMIN, trigger: "manual" })
  assert.equal(held.asked, false)
  assert.equal(held.row.error_code, "rate_limited_manual")
  paced.on = false

  const numbers = fake.count("numbers")
  const labels = fake.count("labels")
  const pass = await runShipmentPass(container)
  assert.equal(pass.created, 0)
  assert.equal(pass.labeled, 0)
  assert.equal(fake.count("numbers"), numbers, "nothing sent without the person")
  assert.equal(fake.count("labels"), labels)
  assert.deepEqual([rowOf(s, pending).state, rowOf(s, failed).state, rowOf(s, label).state], ["pending", "failed", "created"])

  const { plan: again } = await planForShipment(container, pending)
  assert.equal((await createShipment(container, pending, { planHash: again.hash, actor: ADMIN, trigger: "manual" })).state, "labeled", "the person asks again")
})

test("rows the pass cannot act on never fill its page: 250 newer ones each with problems, a manual deferral, a label past the cap, a label code not retried", async () => {
  const { s, fake, ids } = await autoSetup([courierOrder(), courierOrder("order_02", "ful_02")])
  const [toLabel, toCreate] = ids
  fake.failNext("labels", "timeout")
  const { plan } = await planForShipment(s.container, toLabel)
  assert.equal((await createShipment(s.container, toLabel, { planHash: plan.hash, actor: ADMIN, trigger: "manual" })).error_code, "label_unclear")
  rowOf(s, toLabel).created_at = new Date(Date.now() - 60_000)

  const mode = s.options.mode
  const base = { mode, kind: "outbound", option_id: "dpd-courier", order_id: "order_noise", currency: "PLN", references: null, boxes: null, claim_token: null, lease_until: null, error: null }
  for (let n = 0; n < 250; n += 1) {
    const at = new Date(Date.now() + 1000 + n)
    s.shipments.insert({ ...base, fulfillment_id: `ful_noise_p${n}`, state: "pending", problems: [{ code: "address_missing" }], error_code: null, waybills: null, attempts: 0, created_at: at })
    s.shipments.insert({ ...base, fulfillment_id: `ful_noise_m${n}`, state: "pending", problems: null, error_code: "rate_limited_manual", waybills: null, attempts: 0, created_at: at })
    s.shipments.insert({ ...base, fulfillment_id: `ful_noise_l${n}`, state: "created", problems: null, error_code: "label_unclear", waybills: [`W${n}`], attempts: AUTO_LABEL_MAX_ATTEMPTS + 1, created_at: at })
    s.shipments.insert({ ...base, fulfillment_id: `ful_noise_n${n}`, state: "created", problems: null, error_code: "label_not_found", waybills: [`N${n}`], attempts: 1, created_at: at })
  }
  const numbers = fake.count("numbers")
  const pass = await runShipmentPass(s.container)
  assert.equal(pass.created, 1, "the one row that can be created is found behind 500 newer pending rows")
  assert.equal(pass.labeled, 1, "the one label that can be asked again is found behind 500 newer created rows")
  assert.equal(rowOf(s, toCreate).state, "labeled")
  assert.equal(rowOf(s, toLabel).state, "labeled")
  assert.equal(fake.count("numbers"), numbers + 1, "no noise row was sent")
})

const PICKUP = { dpd_option: "dpd-pickup", dpd_kind: "pickup", dpd_cod: false, dpd_pudo_id: "PL14509", dpd_country: "PL" }

function pickupOrder(id: string, ful: string): Row {
  return order({
    id,
    items: [{ id: `li_${id}`, quantity: 1, variant: { weight: 1500 } }],
    shipping_methods: [{ id: `sm_${id}`, name: "DPD Pickup", shipping_option_id: "so_01", data: PICKUP }],
    fulfillments: [{ id: ful, provider_id: "dpd_dpd", data: PICKUP, canceled_at: null }],
  })
}

/** autoCreate armed an hour ago over the sandbox catalog with a points source that can fail; rows recorded before, then placed in the window by `minutesAgo`. */
async function pickupPass(orders: Array<{ order: Row; minutesAgo: number }>, source: PointsSource = catalogSource("sandbox", SANDBOX_POINTS)) {
  const fake = new FakeDpdServices()
  const points = countingPoints(source)
  const s = setup({ ...WRITING, autoCreate: true }, orders.map((o) => o.order), { fake, points })
  const ids: string[] = []
  for (const { order: o } of orders) ids.push(String(((await recordFulfillment(s.container, String(o.id), String((o.fulfillments as Row[])[0].id))) as Row).id))
  arm(s, "shipment")
  const armed = s.settings.rows.find((r) => String(r.key).endsWith("writer:shipment"))
  assert.ok(armed)
  armed.updated_at = new Date(Date.now() - 3_600_000)
  orders.forEach(({ minutesAgo }, n) => void (rowOf(s, ids[n]).created_at = new Date(Date.now() - minutesAgo * 60_000)))
  return { s, fake, points, ids }
}

test("Pickup rows whose point nobody could check never take the slots of the pass: an older courier row behind 10 of them is created (DS13)", async () => {
  const pickups = Array.from({ length: 10 }, (_, n) => ({ order: pickupOrder(`order_p${n}`, `ful_p${n}`), minutesAgo: 1 + n }))
  const { s, fake, points, ids } = await pickupPass([{ order: courierOrder(), minutesAgo: 50 }, ...pickups])
  const [courier, ...rest] = ids
  points.fail.details = "not_configured"
  /* Live without MyPudo credentials (or MyPudo down for hours): every Pickup row waits with point_unchecked. */
  for (const id of rest) rowOf(s, id).error_code = "point_unchecked"
  const reads = points.reads
  const pass = await runShipmentPass(s.container)
  assert.equal(pass.created, 1, "the courier row is created in the same pass")
  assert.equal(rowOf(s, courier).state, "labeled")
  assert.equal(fake.count("numbers"), 1, "no Pickup row was sent")
  for (const id of rest) {
    assert.equal(rowOf(s, id).state, "pending")
    assert.equal(rowOf(s, id).error_code, "point_unchecked")
  }
  assert.equal(points.reads - reads, 10, "the waiting rows are still tried, in their own batch")

  /* Rows not marked yet take a slot once: the first pass marks them, the next one creates the courier row behind them. */
  const fresh = await pickupPass([{ order: courierOrder(), minutesAgo: 50 }, ...pickups])
  fresh.points.fail.details = "not_configured"
  assert.equal((await runShipmentPass(fresh.s.container)).created, 0)
  assert.ok(fresh.ids.slice(1).every((id) => rowOf(fresh.s, id).error_code === "point_unchecked"))
  assert.equal((await runShipmentPass(fresh.s.container)).created, 1)
  assert.equal(rowOf(fresh.s, fresh.ids[0]).state, "labeled")

  /* Once the point can be checked, the waiting rows are sent by the pass. */
  points.fail.details = undefined
  assert.equal((await runShipmentPass(s.container)).created, 10)
  assert.ok(rest.every((id) => rowOf(s, id).state === "labeled" && rowOf(s, id).error_code === null))
})

test("a failed rate_limited Pickup row the point check held back stays the pass's to send: sent once the point is checked (DS13)", async () => {
  const { s, fake, points, ids } = await pickupPass([{ order: pickupOrder("order_p0", "ful_p0"), minutesAgo: 5 }])
  const [id] = ids
  Object.assign(rowOf(s, id), { state: "failed", error_code: "rate_limited", error: "Too many DPD calls from this server.", attempts: 1 })
  points.fail.details = "network"
  assert.equal((await runShipmentPass(s.container)).created, 0)
  assert.equal(fake.calls.length, 0, "nothing to DPD while the point is not checked")
  assert.equal(rowOf(s, id).state, "failed")
  assert.equal(rowOf(s, id).error_code, "point_unchecked")
  assert.equal((await runShipmentPass(s.container)).created, 0, "still not checked: still not sent")
  assert.equal(actionsOf(s, id).filter((a) => a === "create_deferred").length, 1, "one history line")
  points.fail.details = undefined
  assert.equal((await runShipmentPass(s.container)).created, 1)
  assert.equal(rowOf(s, id).state, "labeled")
  assert.equal(rowOf(s, id).error_code, null)
  assert.equal(fake.count("numbers"), 1)
})

test("points that never answer do not hold an older row back: the point_unchecked batch goes oldest try first, each retry moves on (DS13)", async () => {
  /* MyPudo answers PL11111 with something the parser refuses, every time (E17, E27): unchecked for good. */
  const base = catalogSource("sandbox", SANDBOX_POINTS)
  const odd: PointsSource = {
    kind: base.kind,
    search: (q) => base.search(q),
    details: async (pudoId) => (pudoId === "PL11111" ? { status: "unchecked", pudoId, reason: "invalid_answer" } : base.details(pudoId)),
  }
  const stuck = Array.from({ length: 10 }, (_, n) => ({ order: pickupOrder(`order_p${n}`, `ful_p${n}`), minutesAgo: 1 + n }))
  const { s, fake, points, ids } = await pickupPass([{ order: pickupOrder("order_y", "ful_y"), minutesAgo: 50 }, ...stuck], odd)
  const [older, ...rest] = ids
  /* The older row waited while MyPudo was down a moment and was tried last; the ten newer ones were tried before it. */
  Object.assign(rowOf(s, older), { error_code: "point_unchecked", updated_at: new Date(Date.now() - 60_000) })
  rest.forEach((id, n) => Object.assign(rowOf(s, id), { pudo_id: "PL11111", error_code: "point_unchecked", updated_at: new Date(Date.now() - (20 - n) * 60_000) }))
  const lines = s.events.rows.length

  const first = points.reads
  assert.equal((await runShipmentPass(s.container)).created, 0, "the ten tried longest ago go first")
  assert.equal(points.reads - first, 10)
  const second = points.reads
  assert.equal((await runShipmentPass(s.container)).created, 1, "then the older row gets its turn")
  assert.ok(points.reads - second <= 10, "never more than a batch of reads")
  assert.equal(rowOf(s, older).state, "labeled")
  assert.equal(fake.count("numbers"), 1, "nothing went to PL11111")
  for (const id of rest) {
    assert.equal(rowOf(s, id).state, "pending")
    assert.equal(rowOf(s, id).error_code, "point_unchecked")
  }
  assert.equal(s.events.rows.slice(lines).filter((e) => (e.data as Row | null)?.action === "create_deferred").length, 0, "a retry adds no history line")
})

/* Stage 4: the pass and the dispatches (DS8). */

async function dispatchesIn(states: string[]) {
  const fake = new FakeDpdServices({ courier: "works" })
  const s = setup({ ...SANDBOX, mode: "live", shipmentWriter: true, pickupWriter: true }, [], { fake })
  arm(s, "shipment")
  arm(s, "pickup")
  const ids: string[] = []
  for (const [i, state] of states.entries()) {
    const row = insertLabeled(s, labeledOrder(i + 1))
    const { plan } = await planDispatch(s.container, [String(row.id)])
    const view = await createDispatch(s.container, { shipmentIds: [String(row.id)], planHash: plan.hash }, { actor: ADMIN })
    const d = s.dispatches.rows.find((r) => r.id === view.dispatch.id)
    assert.ok(d)
    d.state = state
    ids.push(view.dispatch.id)
  }
  return { s, fake, ids }
}

test("the pass expires dispatch leases and counts them in dispatchesExpired", async () => {
  const { s, fake, ids } = await dispatchesIn(["printing", "ordering", "updating", "printing"])
  const past = (ms: number) => new Date(Date.now() - ms - 1000)
  const at = (i: number) => s.dispatches.rows.find((r) => r.id === ids[i]) as Row
  Object.assign(at(0), { claim_token: "a", lease_until: past(0), error_code: "protocol_unclear" })
  Object.assign(at(1), { claim_token: "b", lease_until: past(0), error_code: "order_unclear", pickup_date: "2026-12-01" })
  Object.assign(at(2), { claim_token: "c", lease_until: past(0), error_code: "update_unclear", order_number: "2026000001", check_sum: "12345678", ordered_at: new Date() })
  Object.assign(at(3), { claim_token: "d", lease_until: new Date(Date.now() + PROTOCOL_LEASE_MS), error_code: "protocol_unclear" })
  const result = await runShipmentPass(s.container, new Date())
  assert.equal(result.dispatchesExpired, 3)
  assert.equal(at(0).state, "pending")
  assert.equal(at(1).state, "unknown")
  assert.equal(at(2).state, "ordered")
  assert.equal(at(2).error_code, "update_unclear")
  assert.equal(at(3).state, "printing", "a lease that did not run out stays")
  assert.equal(fake.calls.length, 0)
  assert.ok(s.logs.some((l) => l.includes("dispatch leases expired")))
})

test("the pass never prints or orders by itself", async () => {
  const { s, fake, ids } = await dispatchesIn(["pending", "printed"])
  await runShipmentPass(s.container, new Date())
  await runShipmentPass(s.container, new Date(Date.now() + 3_600_000))
  assert.deepEqual(ids.map((id) => s.dispatches.rows.find((r) => r.id === id)?.state), ["pending", "printed"])
  assert.equal(fake.count("protocol"), 0)
  assert.equal(fake.count("availability"), 0)
  assert.equal(fake.count("pickupCreate"), 0)
})
