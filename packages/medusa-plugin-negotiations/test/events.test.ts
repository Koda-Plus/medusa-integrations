import { test } from "node:test"
import assert from "node:assert/strict"
import {
  eventData,
  eventForAction,
  NEGOTIATION_ACCEPTED,
  NEGOTIATION_COUNTERED,
  NEGOTIATION_EVENTS,
  NEGOTIATION_EXPIRED,
  NEGOTIATION_MESSAGE_ADDED,
  NEGOTIATION_OPENED,
  NEGOTIATION_REJECTED,
} from "../src/modules/negotiations/lib/events.ts"
import { normalizeThread } from "../src/modules/negotiations/lib/thread.ts"
import type { ThreadRow } from "../src/modules/negotiations/lib/rows.ts"

test("the six event names are a contract", () => {
  assert.deepEqual(
    [...NEGOTIATION_EVENTS],
    ["negotiation.opened", "negotiation.message_added", "negotiation.countered", "negotiation.accepted", "negotiation.rejected", "negotiation.expired"],
  )
  assert.equal(NEGOTIATION_OPENED, "negotiation.opened")
  assert.equal(eventForAction("customer_message"), NEGOTIATION_MESSAGE_ADDED)
  assert.equal(eventForAction("customer_proposal"), NEGOTIATION_MESSAGE_ADDED)
  assert.equal(eventForAction("admin_message"), NEGOTIATION_MESSAGE_ADDED)
  assert.equal(eventForAction("admin_counter"), NEGOTIATION_COUNTERED)
  assert.equal(eventForAction("customer_accept"), NEGOTIATION_ACCEPTED)
  assert.equal(eventForAction("admin_accept"), NEGOTIATION_ACCEPTED)
  assert.equal(eventForAction("customer_decline"), NEGOTIATION_REJECTED)
  assert.equal(eventForAction("admin_reject"), NEGOTIATION_REJECTED)
  assert.equal(eventForAction("expire"), NEGOTIATION_EXPIRED)
  assert.equal(eventForAction("note"), null, "internal notes stay internal")
})

const row: ThreadRow = {
  id: "neg_01",
  ref: "NEG-2026-1001",
  status: "accepted",
  customer_id: "cus_1",
  cart_id: null,
  order_id: null,
  product_id: "prod_1",
  variant_id: "variant_1",
  sku: "KS-ELN-18V",
  qty: 24,
  assigned_to: "user_1",
  metadata: null,
  created_at: "2026-10-06T10:00:00.000Z",
  updated_at: "2026-10-07T10:00:00.000Z",
  demo: true,
  source: "store",
  subject: "variant",
  currency_code: "pln",
  requested_amount: 46900,
  offered_amount: 49900,
  agreed_amount: 49900,
  price_amount: 49900,
  list_amount: 54900,
  last_activity_at: "2026-10-07T10:00:00.000Z",
  message_count: 4,
}

test("the payload: every documented key, decimal strings, minor units, the actor and the demo flag", () => {
  const t = normalizeThread(row, { defaultCurrency: null, expiryDays: 14 })
  const data = eventData(t, { previousStatus: "counter_offered", actor: "customer", actorId: "cus_1", messageId: "negmsg_9" })
  assert.deepEqual(data, {
    id: "neg_01",
    ref: "NEG-2026-1001",
    status: "accepted",
    previous_status: "counter_offered",
    subject: "variant",
    customer_id: "cus_1",
    product_id: "prod_1",
    variant_id: "variant_1",
    cart_id: null,
    sku: "KS-ELN-18V",
    qty: 24,
    price: "499.00",
    price_amount: 49900,
    requested_price: "469.00",
    offered_price: "499.00",
    agreed_price: "499.00",
    currency_code: "pln",
    expires_at: null,
    actor: "customer",
    actor_id: "cus_1",
    message_id: "negmsg_9",
    demo: true,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data, "plain JSON, safe for any event bus")
  for (const key of ["id", "ref", "status", "customer_id", "product_id", "variant_id", "qty", "price", "currency_code", "demo"]) {
    assert.ok(key in data, `the brief's minimum: ${key}`)
  }
})
