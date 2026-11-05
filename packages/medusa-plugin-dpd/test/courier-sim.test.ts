/**
 * The simulated courier order of demo and sandbox (spec 9.1, DS4): numbers
 * SBX plus 11 digits, an 8 digit checkSum, the same validation DPD applies
 * (12d, 12g, 12h), INCORRECT_CHECKSUM, INCORRECT_STATUS and
 * ORDER_CLOSED_STATUS on a change, an unknown order unclear as on the test
 * host (12u, 12v), and a wrapper that takes only packagesPickupCall from it.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createCourierSimulator, simulatedOrderNumber, withSimulatedCourier } from "../src/modules/dpd/lib/courier-sim.ts"
import { classifyPickupCallAnswer } from "../src/modules/dpd/lib/dpd-answers.ts"
import type { DpdServicesClient, PackagesPickupCallCreateRequest, PackagesPickupCallUpdateRequest } from "../src/modules/dpd/lib/dpdservices.ts"
import { loadFixture } from "./fake-dpdservices.ts"

const PAYER = 1000
/* 3 November 2026, 10:00 in Warsaw (CET, UTC+1). */
const NOW = new Date("2026-11-03T09:00:00Z")

function sim(now: () => Date = () => NOW) {
  return createCourierSimulator({ payerFid: PAYER, now, random: () => 0.5 })
}

function create(overrides: Partial<PackagesPickupCallCreateRequest> = {}, parcel: Partial<PackagesPickupCallCreateRequest["packagesForCollection"]["packagesParams"]["parcel"]> = {}, payer = PAYER): PackagesPickupCallCreateRequest {
  const base: PackagesPickupCallCreateRequest = JSON.parse(JSON.stringify(loadFixture("12a-order").request.body).replace(/"number":"\*\*\*"/, `"number":${payer}`))
  return {
    ...base,
    pickupDate: "2026-11-04",
    ...overrides,
    packagesForCollection: { ...base.packagesForCollection, packagesParams: { doxCount: 0, parcel: { ...base.packagesForCollection.packagesParams.parcel, ...parcel } } },
  }
}

function update(orderNumber: string, checkSum: string, window: Partial<Pick<PackagesPickupCallUpdateRequest, "pickupDate" | "pickupTimeFrom" | "pickupTimeTo">> = {}, count = 1): PackagesPickupCallUpdateRequest {
  const c = create()
  return {
    orderNumber,
    checkSum,
    updateMode: "DONT_CREATE_NEW_IF_CLOSED",
    pickupDate: "2026-11-05",
    pickupTimeFrom: "11:00",
    pickupTimeTo: "14:00",
    ...window,
    waybillsReady: true,
    packagesForCollection: {
      payer: { name: "Testowa Firma Sp. z o.o." },
      sender: { name: c.packagesForCollection.sender.name, fullName: c.packagesForCollection.sender.fullName, address: c.packagesForCollection.sender.address, city: c.packagesForCollection.sender.city, phone: c.packagesForCollection.sender.phone },
      packagesParams: { doxCount: 0, parcel: { ...c.packagesForCollection.packagesParams.parcel, count } },
    },
  }
}

function answerOf(name: string) {
  const f = loadFixture(name)
  return { httpStatus: f.response.httpStatus, body: f.response.body, text: "", traceId: null, ms: 0 }
}

async function ordered(s = sim()) {
  const o = await s.pickupCallCreate(create())
  assert.equal(o.kind, "ok")
  if (o.kind !== "ok") throw new Error("not ordered")
  return { s, orderNumber: o.orderNumber, checkSum: o.checkSum }
}

test("simulatedOrderNumber pads to SBX and 11 digits", () => {
  assert.equal(simulatedOrderNumber(42), "SBX00000000042")
  assert.equal(simulatedOrderNumber(1_762_160_400), "SBX01762160400")
  assert.equal(simulatedOrderNumber(123_456_789_012), "SBX23456789012", "kept to 11 digits")
  assert.match(simulatedOrderNumber(0), /^SBX\d{11}$/)
})

test("create: OK with an order number and an 8 digit checkSum", async () => {
  const s = createCourierSimulator({ payerFid: PAYER, now: () => NOW, random: () => 0 })
  const first = await s.pickupCallCreate(create())
  const second = await s.pickupCallCreate(create({}, { count: 3 }))
  assert.equal(first.kind, "ok")
  assert.equal(second.kind, "ok")
  if (first.kind !== "ok" || second.kind !== "ok") return
  const start = Math.floor(NOW.getTime() / 1000) % 100_000_000_000
  assert.equal(first.orderNumber, simulatedOrderNumber(start))
  assert.equal(second.orderNumber, simulatedOrderNumber(start + 1))
  assert.equal(first.checkSum, "10000000", "random() = 0 gives the smallest 8 digit number")
  assert.equal(first.traceId, null)
  assert.equal(first.httpStatus, 200)
  assert.deepEqual(s.orders.get(second.orderNumber), {
    orderNumber: second.orderNumber, checkSum: second.checkSum, pickupDate: "2026-11-04", pickupTimeFrom: "09:00", pickupTimeTo: "17:00", parcels: 3, canceled: false,
  })
  const high = await createCourierSimulator({ payerFid: PAYER, now: () => NOW, random: () => 0.999999999 }).pickupCallCreate(create())
  assert.ok(high.kind === "ok" && /^[1-9]\d{7}$/.test(high.checkSum), "always 8 digits, no leading zero")
})

test("create refuses a payer other than the simulator FID (12h shape)", async () => {
  const o = await sim().pickupCallCreate(create({}, {}, 1234))
  const dpd = classifyPickupCallAnswer(answerOf("12h-order-wrong-payer"))
  assert.equal(o.kind, "refused")
  if (o.kind !== "refused" || dpd.kind !== "refused") return
  assert.deepEqual([o.code, o.httpStatus, o.problems], [dpd.code, dpd.httpStatus, dpd.problems])
})

test("create refuses a box over 50 kg (12g shape) and a past date (12d shape)", async () => {
  const s = sim()
  const heavy = await s.pickupCallCreate(create({}, { maxWeight: 51, weight: 51 }))
  const past = await s.pickupCallCreate(create({ pickupDate: "2026-11-02" }))
  for (const [o, name] of [[heavy, "12g-order-maxweight-51"], [past, "12d-order-yesterday"]] as const) {
    const dpd = classifyPickupCallAnswer(answerOf(name))
    assert.ok(o.kind === "refused" && dpd.kind === "refused", name)
    if (o.kind !== "refused" || dpd.kind !== "refused") continue
    assert.deepEqual([o.code, o.httpStatus, o.problems], [dpd.code, dpd.httpStatus, dpd.problems], name)
  }
  /* The window shape DPD did not check (12e): refused pickup_time as a VALIDATION_ERROR under HTTP 200. */
  const backwards = await s.pickupCallCreate(create({ pickupTimeFrom: "17:00", pickupTimeTo: "09:00" }))
  assert.equal(backwards.kind, "refused")
  if (backwards.kind === "refused") {
    assert.equal(backwards.code, "pickup_time")
    assert.equal(backwards.httpStatus, 200)
    assert.deepEqual(backwards.problems, [{ code: "dpd_courier", field: "pickupTimeTo", detail: "INCORRECT_PICKUP_TIME" }])
  }
  assert.equal(s.orders.size, 0, "a refusal stores nothing")
})

test("update with the right checkSum moves the window and keeps the order number and checkSum", async () => {
  const { s, orderNumber, checkSum } = await ordered()
  const o = await s.pickupCallUpdate(update(orderNumber, checkSum, {}, 2))
  assert.deepEqual(o, { kind: "ok", orderNumber, checkSum, traceId: null, httpStatus: 200 })
  const stored = s.orders.get(orderNumber)
  assert.deepEqual([stored?.pickupDate, stored?.pickupTimeFrom, stored?.pickupTimeTo, stored?.parcels, stored?.canceled], ["2026-11-05", "11:00", "14:00", 2, false])
  const backwards = await s.pickupCallUpdate(update(orderNumber, checkSum, { pickupTimeFrom: "14:00", pickupTimeTo: "11:00" }))
  assert.equal(backwards.kind === "refused" && backwards.code, "pickup_time")
})

test("update or delete with a wrong checkSum: INCORRECT_CHECKSUM", async () => {
  const { s, orderNumber } = await ordered()
  const upd = await s.pickupCallUpdate(update(orderNumber, "87654321"))
  const del = await s.pickupCallDelete({ orderNumber, checkSum: "87654321" })
  for (const o of [upd, del]) {
    assert.equal(o.kind, "refused")
    if (o.kind !== "refused") continue
    assert.equal(o.code, "checksum")
    assert.equal(o.httpStatus, 200)
    assert.deepEqual(o.problems, [{ code: "dpd_courier", field: "checkSum", detail: "INCORRECT_CHECKSUM" }])
    assert.ok(!o.message.includes("87654321"), "the checkSum never reaches the message")
  }
  /* A checkSum of three characters is refused before anything is looked up (12w). */
  const short = await s.pickupCallDelete({ orderNumber, checkSum: "123" })
  assert.deepEqual(short.kind === "refused" && [short.code, short.httpStatus], ["checksum", 400])
  assert.equal(s.orders.get(orderNumber)?.canceled, false)
})

test("update after delete: INCORRECT_STATUS; a closed order: ORDER_CLOSED_STATUS", async () => {
  const { s, orderNumber, checkSum } = await ordered()
  const del = await s.pickupCallDelete({ orderNumber, checkSum })
  assert.deepEqual(del, { kind: "ok", orderNumber, checkSum, traceId: null, httpStatus: 200 })
  assert.equal(s.orders.get(orderNumber)?.canceled, true)
  for (const o of [await s.pickupCallUpdate(update(orderNumber, checkSum)), await s.pickupCallDelete({ orderNumber, checkSum })]) {
    assert.ok(o.kind === "refused" && o.code === "order_status", JSON.stringify(o))
  }
  /* Closed: today with the window begun (10:00 >= 09:00), or a day that has passed. */
  let now = NOW
  const today = createCourierSimulator({ payerFid: PAYER, now: () => now, random: () => 0.5 })
  const t = await today.pickupCallCreate(create({ pickupDate: "2026-11-03", pickupTimeFrom: "11:00", pickupTimeTo: "14:00" }))
  assert.equal(t.kind, "ok")
  if (t.kind !== "ok") return
  now = new Date("2026-11-03T10:00:00Z")
  const closed = await today.pickupCallUpdate(update(t.orderNumber, t.checkSum))
  assert.equal(closed.kind === "refused" && closed.code, "order_closed")
  if (closed.kind === "refused") assert.deepEqual(closed.problems, [{ code: "dpd_courier", field: "orderNumber", detail: "ORDER_CLOSED_STATUS" }])
  now = new Date("2026-11-05T09:00:00Z")
  const cancel = await today.pickupCallDelete({ orderNumber: t.orderNumber, checkSum: t.checkSum })
  assert.equal(cancel.kind === "refused" && cancel.code, "order_closed")
})

test("an order unknown to this process is unclear server_error (restart, like 12u and 12v)", async () => {
  const { orderNumber, checkSum } = await ordered()
  const restarted = sim()
  const upd = await restarted.pickupCallUpdate(update(orderNumber, checkSum))
  const del = await restarted.pickupCallDelete({ orderNumber, checkSum })
  for (const o of [upd, del]) {
    assert.equal(o.kind, "unclear")
    if (o.kind !== "unclear") continue
    assert.equal(o.code, "server_error")
    assert.equal(o.httpStatus, 500)
    assert.ok(!o.message.includes(checkSum))
  }
})

test("withSimulatedCourier takes only packagesPickupCall from the simulator", async () => {
  const seen: string[] = []
  const unclear = { kind: "unclear" as const, code: "network" as const, message: "x", traceId: null, httpStatus: 0 }
  const client: DpdServicesClient = {
    host: "https://example.test",
    generatePackagesNumbers: async () => (seen.push("numbers"), unclear),
    generateSpedLabels: async () => (seen.push("labels"), unclear),
    generateProtocol: async () => (seen.push("protocol"), unclear),
    courierOrderAvailability: async () => (seen.push("availability"), unclear),
    pickupCallCreate: async () => (seen.push("create"), unclear),
    pickupCallUpdate: async () => (seen.push("update"), unclear),
    pickupCallDelete: async () => (seen.push("delete"), unclear),
  }
  const s = sim()
  const wrapped = withSimulatedCourier(client, s)
  assert.notEqual(wrapped, client)
  assert.equal(wrapped.host, client.host)
  const order = await wrapped.pickupCallCreate(create())
  assert.equal(order.kind, "ok")
  if (order.kind === "ok") {
    await wrapped.pickupCallUpdate(update(order.orderNumber, order.checkSum))
    await wrapped.pickupCallDelete({ orderNumber: order.orderNumber, checkSum: order.checkSum })
  }
  assert.deepEqual(seen, [], "the courier never reached the client")
  await wrapped.generateProtocol({ protocolSearchParams: { policy: "STOP_ON_FIRST_ERROR", session: { type: "DOMESTIC", packages: [] }, pickupAddress: { fid: PAYER } }, outputDocFormat: "PDF" })
  await wrapped.courierOrderAvailability({ countryCode: "PL", zipCode: "02274" })
  assert.deepEqual(seen, ["protocol", "availability"])
  assert.equal(s.orders.size, 1)
  assert.equal(client.pickupCallCreate === wrapped.pickupCallCreate, false, "the source client is not changed")
})
