/**
 * ShipX statuses: the stage each one means for the store, the lists of the
 * Panel, what ShipX still allows (cancel, label), when InPost has the parcel,
 * the end of tracking, and the events a change emits.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { groupOf, toParcelDto, type ParcelRow } from "../src/modules/inpost/lib/dto.ts"
import { createdEvents, SHIPMENT_CREATED_EVENT, SHIPMENT_DELIVERED_EVENT, SHIPMENT_STATUS_CHANGED_EVENT, statusEvents, type EventSourceRow } from "../src/modules/inpost/lib/events.ts"
import { isCancellable, isFinalStatus, isLabelAvailable, isPickedUp, KNOWN_STATUSES, needsPayment, shipmentStage, trackingUrl } from "../src/modules/inpost/lib/statuses.ts"
import { readFileSync } from "node:fs"
import en from "../src/admin/i18n/en.ts"

test("stages: the road of a parcel, problems and returns apart, unknown statuses in transit", () => {
  assert.equal(shipmentStage("created"), "preparing")
  assert.equal(shipmentStage("offers_prepared"), "preparing")
  assert.equal(shipmentStage("confirmed"), "ready")
  assert.equal(shipmentStage("collected_from_sender"), "in_transit")
  assert.equal(shipmentStage("out_for_delivery_to_address"), "in_transit")
  assert.equal(shipmentStage("ready_to_pickup"), "in_locker")
  assert.equal(shipmentStage("ready_to_pickup_from_pok"), "in_locker")
  assert.equal(shipmentStage("pickup_reminder_sent"), "in_locker")
  assert.equal(shipmentStage("delivered"), "delivered")
  assert.equal(shipmentStage("pickup_time_expired"), "problem")
  assert.equal(shipmentStage("undelivered_wrong_address"), "problem")
  assert.equal(shipmentStage("returned_to_sender"), "returned")
  assert.equal(shipmentStage("canceled"), "canceled")
  assert.equal(shipmentStage("delay_in_delivery"), "in_transit", "a possible delay is not a reason to act")
  assert.equal(shipmentStage("a_status_from_the_future"), "in_transit")
  assert.equal(shipmentStage(null), "preparing")
})

test("what ShipX allows: cancel before payment only, the label from confirmed on, payment of a prepaid offer", () => {
  for (const s of ["created", "offers_prepared", "offer_selected"]) assert.equal(isCancellable(s), true, s)
  for (const s of ["confirmed", "collected_from_sender", "delivered", null]) assert.equal(isCancellable(s), false, String(s))
  assert.equal(isLabelAvailable("created"), false)
  assert.equal(isLabelAvailable("confirmed"), true)
  assert.equal(isLabelAvailable("delivered"), true)
  assert.equal(isLabelAvailable("canceled"), false)
  assert.equal(needsPayment("offers_prepared"), true)
  assert.equal(needsPayment("created"), false)
})

test("InPost has the parcel from the pickup or the drop-off on; tracking ends at the final statuses", () => {
  assert.equal(isPickedUp("confirmed"), false)
  assert.equal(isPickedUp("dispatched_by_sender"), true)
  assert.equal(isPickedUp("taken_by_courier"), true)
  assert.equal(isPickedUp("ready_to_pickup"), true)
  assert.equal(isPickedUp("delivered"), true)
  for (const s of ["delivered", "returned_to_sender", "canceled", "return_pickup_confirmation_to_sender"]) assert.equal(isFinalStatus(s), true, s)
  assert.equal(isFinalStatus("ready_to_pickup"), false)
  assert.equal(trackingUrl("600000000000000000001042"), "https://inpost.pl/sledzenie-przesylek?number=600000000000000000001042")
})

test("every status of the public dictionary has an English and a Polish name, and Polish names keep their letters", () => {
  const enStatus = en.status as Record<string, string>
  /* pl.ts imports the page kit (a .tsx file), so it is read as text here. */
  const plText = readFileSync(new URL("../src/admin/i18n/pl.ts", import.meta.url), "utf8")
  for (const s of KNOWN_STATUSES) {
    assert.ok(enStatus[s], `en ${s}`)
    assert.match(plText, new RegExp(`\\n\\s+${s}: "[^"]+"`), `pl ${s}`)
  }
  assert.match(plText, /ready_to_pickup: "[^"]*Paczkomacie/)
})

function row(over: Partial<ParcelRow> = {}): ParcelRow {
  return {
    id: "inpar_1",
    order_id: "order_1",
    display_id: 1042,
    fulfillment_id: "ful_1",
    demo: false,
    option_id: "inpost-paczkomat-cod",
    kind: "locker",
    cod: true,
    service: "inpost_locker_standard",
    locker_code: "KSP01M",
    locker_name: "Paczkomat KSP01M",
    locker_address: { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" },
    parcel_size: "small",
    parcel_no: 1,
    cod_minor: 19999,
    currency: "PLN",
    reference: "Order 1042",
    state: "created",
    status: "confirmed",
    status_at: null,
    shipment_id: "1001",
    tracking_number: "600000000000000000001042",
    sending_method: null,
    plan_hash: null,
    problems: null,
    skip_reason: null,
    external: false,
    error: null,
    error_code: null,
    attempts: 1,
    claim_token: null,
    claimed_at: null,
    lease_until: null,
    created_by: "user_1",
    shipment_created_at: null,
    offer: null,
    buy_requested_at: null,
    dispatch_state: null,
    dispatch_order_id: null,
    dispatch_error: null,
    dispatch_at: null,
    fulfillment_canceled_at: null,
    shipped_marked_at: null,
    delivered_marked_at: null,
    status_writer_error: null,
    last_checked_at: null,
    ...over,
  }
}

test("the Panel lists: by our state first, then by the ShipX stage", () => {
  assert.equal(groupOf("pending", null), "to_create")
  assert.equal(groupOf("unknown", null), "to_create")
  assert.equal(groupOf("failed", null), "to_create")
  assert.equal(groupOf("created", "confirmed"), "waiting")
  assert.equal(groupOf("created", null), "waiting")
  assert.equal(groupOf("created", "sent_from_sorting_center"), "in_transit")
  assert.equal(groupOf("created", "ready_to_pickup"), "in_locker")
  assert.equal(groupOf("created", "delivered"), "delivered")
  assert.equal(groupOf("created", "returned_to_sender"), "problems")
  assert.equal(groupOf("created", "avizo"), "problems")
  assert.equal(groupOf("skipped", null), "skipped")
  assert.equal(groupOf("canceled", "canceled"), "canceled")
})

test("the admin row: money as text, actions from the state and the status, no tracking link for demo rows", () => {
  const dto = toParcelDto(row())
  assert.equal(dto.codAmount, "199.99")
  assert.equal(dto.trackingUrl, "https://inpost.pl/sledzenie-przesylek?number=600000000000000000001042")
  assert.deepEqual(
    Object.entries(dto.actions).filter(([, v]) => v).map(([k]) => k),
    ["label", "refresh"],
  )
  const fresh = toParcelDto(row({ status: "created", tracking_number: null }))
  assert.equal(fresh.actions.cancel, true)
  assert.equal(fresh.actions.label, false)
  const offer = toParcelDto(row({ status: "offers_prepared", offer: { id: 7, rate: 13.99, currency: "PLN", status: "available" } }))
  assert.equal(offer.actions.buy, true)
  assert.deepEqual(offer.offer, { id: "7", rate: 13.99, currency: "PLN", status: "available" })
  assert.equal(toParcelDto(row({ external: true, status: "created" })).actions.cancel, false, "never cancel a shipment the plugin did not create")
  const pending = toParcelDto(row({ state: "pending", status: null, shipment_id: null, tracking_number: null }))
  assert.equal(pending.actions.create, true)
  assert.equal(pending.actions.changeLocker, true)
  assert.equal(pending.actions.label, false)
  assert.equal(toParcelDto(row({ demo: true })).trackingUrl, null)
})

const source = (over: Partial<EventSourceRow> = {}): EventSourceRow => ({
  id: "inpar_1",
  order_id: "order_1",
  fulfillment_id: "ful_1",
  shipment_id: "1001",
  tracking_number: "600000000000000000001042",
  status: "ready_to_pickup",
  service: "inpost_locker_standard",
  kind: "locker",
  locker_code: "KSP01M",
  locker_name: "Paczkomat KSP01M",
  locker_address: null,
  cod: true,
  cod_amount: "199.99",
  demo: false,
  ...over,
})

test("events: the documented payload, status_changed once per change, delivered after it, nothing without a change", () => {
  const [changed] = statusEvents(source(), "out_for_delivery")
  assert.equal(changed.name, SHIPMENT_STATUS_CHANGED_EVENT)
  assert.deepEqual(changed.data, {
    id: "inpar_1",
    order_id: "order_1",
    fulfillment_id: "ful_1",
    shipment_id: "1001",
    tracking_number: "600000000000000000001042",
    tracking_url: "https://inpost.pl/sledzenie-przesylek?number=600000000000000000001042",
    status: "ready_to_pickup",
    previous_status: "out_for_delivery",
    stage: "in_locker",
    service: "inpost_locker_standard",
    kind: "locker",
    locker: { code: "KSP01M", name: "Paczkomat KSP01M", address: null },
    cod: { amount: "199.99", currency: "PLN" },
    demo: false,
  })
  assert.deepEqual(statusEvents(source({ status: "delivered" }), "ready_to_pickup").map((e) => e.name), [SHIPMENT_STATUS_CHANGED_EVENT, SHIPMENT_DELIVERED_EVENT])
  assert.deepEqual(statusEvents(source(), "ready_to_pickup"), [])
  assert.deepEqual(createdEvents(source({ status: "created" })).map((e) => e.name), [SHIPMENT_CREATED_EVENT])
  assert.deepEqual(createdEvents(source({ shipment_id: null })), [], "no shipment, no event")
  assert.equal(statusEvents(source({ kind: "courier", locker_code: null }), "x")[0].data.locker, null)
  const text = JSON.stringify(statusEvents(source(), "x"))
  assert.equal(/anna|nowak|example\.com|\d{9}\b/i.test(text.replace(/600000000000000000001042/g, "")), false, "no personal data in events")
})
