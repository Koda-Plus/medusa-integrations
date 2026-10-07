/**
 * The ShipX webhook: the secret compared in constant time, the body parsed
 * leniently, a delivery recorded once, the shipment read from ShipX (the body
 * is never believed), the status applied once whoever comes first, and the
 * fulfillment status writer that follows the statuses when armed.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseWebhook, secretMatches, webhookPath } from "../src/modules/inpost/lib/webhook.ts"
import { createShipment, planForParcel, recordFulfillment } from "../src/workflows/inpost/parcels.ts"
import { CORE_FLOWS_KEY } from "../src/workflows/inpost/status-writer.ts"
import { handleWebhookCall } from "../src/workflows/inpost/webhook.ts"
import { arm, LIVE, ORG, order, SECRET, setup, withFulfillment, type Row } from "./helpers.ts"

const FUL = "ful_01TEST0000000000000000001"
const LOCKER_DATA = { type: "paczkomat", cod: true, machine_id: "KSP01M", machine_name: "KSP01M", machine_address: null, inpost_option: "inpost-paczkomat-cod" }

test("the secret: equal only to itself, whatever the length; nothing matches an empty secret", () => {
  assert.equal(secretMatches(SECRET, SECRET), true)
  assert.equal(secretMatches(SECRET.toUpperCase(), SECRET), false)
  assert.equal(secretMatches(`${SECRET}x`, SECRET), false)
  assert.equal(secretMatches(SECRET.slice(0, 10), SECRET), false)
  assert.equal(secretMatches("", SECRET), false)
  assert.equal(secretMatches(undefined, SECRET), false)
  assert.equal(secretMatches(SECRET, ""), false)
  assert.equal(secretMatches("x".repeat(5000), SECRET), false)
  assert.equal(webhookPath(SECRET), `/hooks/inpost/${SECRET}`)
  assert.equal(webhookPath(""), null)
})

test("the body: the three ShipX events, a key per delivery, anything else ignored", () => {
  const status = parseWebhook({ event_ts: "2026-10-07 12:08:42 +0200", event: "shipment_status_changed", organization_id: Number(ORG), payload: { shipment_id: 49, status: "delivered", tracking_number: "600000000000000000001042" } })
  assert.ok(status.ok)
  if (status.ok) {
    assert.deepEqual(status.call, {
      event: "shipment_status_changed",
      shipmentId: "49",
      status: "delivered",
      trackingNumber: "600000000000000000001042",
      organizationId: ORG,
      eventTs: "2026-10-07 12:08:42 +0200",
      key: "webhook:shipment_status_changed:49:delivered:2026-10-07 12:08:42 +0200",
    })
  }
  const confirmed = parseWebhook({ event: "shipment_confirmed", payload: { shipment_id: "49", tracking_number: "6".repeat(24) } })
  assert.equal(confirmed.ok && confirmed.call.status, "confirmed")
  const offers = parseWebhook({ event: "offers_prepared", payload: { shipment_id: 50, offers: [] } })
  assert.equal(offers.ok && offers.call.status, "offers_prepared")
  assert.deepEqual(parseWebhook({ event: "shipment_status_changed", payload: { shipment_id: "1; DROP" } }), { ok: false, reason: "no_shipment" })
  assert.deepEqual(parseWebhook({ event: "something_else", payload: { shipment_id: 1 } }), { ok: false, reason: "unknown_event" })
  assert.deepEqual(parseWebhook("not json"), { ok: false, reason: "not_json" })
  const odd = parseWebhook({ event: "shipment_status_changed", payload: { shipment_id: 1, status: "<b>x</b>", tracking_number: "x y" } })
  assert.ok(odd.ok && odd.call.status === null && odd.call.trackingNumber === null)
})

async function shipped(over: Row = {}) {
  const s = setup({ ...LIVE, ...over }, [withFulfillment(order(), LOCKER_DATA, FUL)])
  const row = await recordFulfillment(s.container, "order_01KODASUPPLY000000000001", FUL)
  assert.ok(row)
  await arm(s, "shipment")
  const { plan } = await planForParcel(s.container, row.id)
  const created = await createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  return { s, row: created, shipmentId: String(created.shipment_id) }
}

const call = (shipmentId: string, status: string, ts = "2026-10-07 12:00:00 +0200") => {
  const p = parseWebhook({ event: "shipment_status_changed", organization_id: Number(ORG), event_ts: ts, payload: { shipment_id: shipmentId, status } })
  if (!p.ok) throw new Error("bad call")
  return p.call
}

test("a delivery reads the shipment from ShipX: a forged status in the body changes nothing", async () => {
  const { s, shipmentId } = await shipped()
  const forged = call(shipmentId, "delivered")
  assert.equal(await handleWebhookCall(s.container, forged), "applied")
  assert.equal(s.parcels.rows[0].status, "created", "ShipX still says created: the body is not believed")
  assert.equal(s.emitted.filter((e) => e.name === "inpost.shipment.delivered").length, 0)
})

test("idempotent: the same delivery twice is one receipt; the same status from the webhook and the pass is one change", async () => {
  const { s, shipmentId } = await shipped()
  s.fake.set(shipmentId, "ready_to_pickup", { tracking_number: "6".repeat(24) })
  const c = call(shipmentId, "ready_to_pickup")
  assert.equal(await handleWebhookCall(s.container, c), "applied")
  assert.equal(await handleWebhookCall(s.container, c), "duplicate")
  assert.equal(await handleWebhookCall(s.container, call(shipmentId, "ready_to_pickup", "2026-10-07 12:05:00 +0200")), "applied", "a new delivery of the same status is read, and changes nothing")
  assert.equal(s.emitted.filter((e) => e.name === "inpost.shipment.status_changed").length, 1)
  assert.equal(s.events.rows.filter((e) => e.kind === "webhook").length, 2)
  assert.ok(s.settings.rows.some((r) => r.key === "webhook:last"))
})

test("deliveries of another organization, of unknown shipments, and in demo mode change nothing", async () => {
  const { s, shipmentId } = await shipped()
  const foreign = parseWebhook({ event: "shipment_status_changed", organization_id: 999, payload: { shipment_id: shipmentId, status: "delivered" } })
  assert.ok(foreign.ok)
  if (foreign.ok) assert.equal(await handleWebhookCall(s.container, foreign.call), "foreign")
  assert.equal(await handleWebhookCall(s.container, call("424242", "delivered")), "unmatched")
  const demo = setup({}, [])
  assert.equal(await handleWebhookCall(demo.container, call("1", "delivered")), "demo")
})

test("the fulfillment status writer: nothing while disarmed; armed, shipped with the tracking link once, then delivered once", async () => {
  const { s, shipmentId } = await shipped()
  const runs: Array<{ flow: string; input: Row }> = []
  const flow = (name: string) => () => ({ run: async ({ input }: { input: Row }) => void runs.push({ flow: name, input }) })
  ;(s.container as { resolve: (k: string, o?: unknown) => unknown }).resolve = ((original) => (key: string, opts?: unknown) =>
    key === CORE_FLOWS_KEY ? { createOrderShipmentWorkflow: flow("ship"), markOrderFulfillmentAsDeliveredWorkflow: flow("deliver") } : original(key, opts as never))(s.container.resolve)
  s.fake.set(shipmentId, "collected_from_sender", { tracking_number: "6".repeat(24) })
  await handleWebhookCall(s.container, call(shipmentId, "collected_from_sender"))
  assert.equal(runs.length, 0, "the writer is not armed")
  await arm(s, "fulfillmentStatus")
  s.fake.set(shipmentId, "ready_to_pickup")
  await handleWebhookCall(s.container, call(shipmentId, "ready_to_pickup", "t2"))
  s.fake.set(shipmentId, "delivered")
  await handleWebhookCall(s.container, call(shipmentId, "delivered", "t3"))
  await handleWebhookCall(s.container, call(shipmentId, "delivered", "t4"))
  assert.deepEqual(runs.map((r) => r.flow), ["ship", "deliver"])
  assert.deepEqual(runs[0].input, {
    order_id: "order_01KODASUPPLY000000000001",
    fulfillment_id: FUL,
    items: [
      { id: "ordli_1", quantity: 2 },
      { id: "ordli_2", quantity: 1 },
    ],
    labels: [{ tracking_number: "6".repeat(24), tracking_url: `https://inpost.pl/sledzenie-przesylek?number=${"6".repeat(24)}`, label_url: "" }],
  })
  assert.deepEqual(runs[1].input, { orderId: "order_01KODASUPPLY000000000001", fulfillmentId: FUL })
})
