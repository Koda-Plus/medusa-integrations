/**
 * InPost in the koda.integration/1 contract: the shared conformance checks
 * on sample rows, then what InPost itself promises: the worst parcel of an
 * order speaks, the checkout's choice shows before any fulfillment, cash on
 * delivery is a payment fact, tracking links only for live parcels, and
 * nothing is read from order metadata.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { inpostIntegration } from "../src/workflows/inpost/integration.ts"
import { makeContext } from "../src/modules/inpost/lib/kit-routes.ts"
import { conformance } from "./kit-conformance.ts"
import { LIVE, order, setup, type Row } from "./helpers.ts"

const A = "order_01INTEGRATION0000000001"
const B = "order_01INTEGRATION0000000002"
const C = "order_01INTEGRATION0000000003"

function sample() {
  const s = setup(LIVE, [
    order({ id: A, display_id: 1001 }),
    order({ id: B, display_id: 1002 }),
    order({
      id: C,
      display_id: 1003,
      /* A shopper's metadata must change nothing. */
      metadata: { inpost_shipment: { shipment_id: 999 }, allegro_payment_type: "CASH_ON_DELIVERY" },
      shipping_methods: [{ id: "ordsm_c", name: "InPost Paczkomat pobranie", data: { type: "paczkomat", cod: true, machine_id: "WAW22A", machine_name: "WAW22A" } }],
    }),
  ])
  const base = { demo: false, option_id: "paczkomat", kind: "locker", cod: false, service: "inpost_locker_standard", locker_code: "KSP01M", parcel_size: "small", currency: "PLN", external: false, attempts: 0 }
  s.parcels.insert({ ...base, order_id: A, display_id: 1001, fulfillment_id: "ful_a1", parcel_no: 1, state: "created", status: "delivered", shipment_id: "1", tracking_number: "600000000000000000000001", status_at: "2026-10-06T10:00:00Z" })
  s.parcels.insert({ ...base, order_id: A, display_id: 1001, fulfillment_id: "ful_a2", parcel_no: 2, state: "created", status: "pickup_time_expired", shipment_id: "2", tracking_number: "600000000000000000000002", status_at: "2026-10-07T10:00:00Z" })
  s.parcels.insert({ ...base, order_id: B, display_id: 1002, fulfillment_id: "ful_b1", parcel_no: 1, state: "pending", cod: true, cod_minor: 12999 })
  return s
}

function recordWrites(s: ReturnType<typeof sample>) {
  const calls: string[] = []
  const store = s.store as unknown as Record<string, unknown>
  for (const k of Object.keys(store)) {
    const fn = store[k]
    if (typeof fn !== "function" || k === "counts") continue
    store[k] = (...args: unknown[]) => {
      calls.push(`store.${k}`)
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  }
  const bus = s.container.resolve("event_bus")
  const emit = bus.emit
  bus.emit = (...args: unknown[]) => {
    calls.push("event_bus.emit")
    return emit(...args)
  }
  return () => calls
}

{
  const s = sample()
  conformance({ routes: inpostIntegration, scope: s.container, entity: "order", knownIds: [A, B, C], writes: recordWrites(s) })
}

test("the worst parcel of the order speaks, with the count of the others", async () => {
  const s = sample()
  const [a] = await inpostIntegration.build.summaries(makeContext({ scope: s.container, lang: "pl" }), "order", [A])
  assert.equal(a.state, "failed")
  assert.equal(a.title.key, "integration.order.problem")
  assert.equal(a.detail?.key, "integration.order.more")
  assert.equal(a.detail?.params?.count, 1)
  assert.equal(a.counts.parcels, 2)
  assert.equal(a.counts.delivered, 1)
  const delivery = a.facts.find((f) => f.slot === "delivery")
  assert.equal(delivery?.link?.kind, "external")
  assert.match(delivery?.link?.href ?? "", /^https:\/\/inpost\.pl\//)
})

test("a pending parcel waits for a person and says when nobody armed the writer", async () => {
  const s = sample()
  const [b] = await inpostIntegration.build.summaries(makeContext({ scope: s.container, lang: "en" }), "order", [B])
  assert.equal(b.state, "attention")
  assert.equal(b.title.fallback, "To ship to locker KSP01M")
  assert.equal(b.detail?.key, "integration.order.notArmed")
  const cod = b.facts.find((f) => f.slot === "payment")
  assert.equal(cod?.value.key, "integration.fact.codAmount")
  assert.match(String(cod?.value.params?.amount), /129[.,]99/)
})

test("before any fulfillment the checkout's choice shows; metadata changes nothing", async () => {
  const s = sample()
  const [c] = await inpostIntegration.build.summaries(makeContext({ scope: s.container }), "order", [C])
  assert.equal(c.state, "none")
  assert.equal(c.title.key, "integration.order.chosenLocker")
  assert.equal(c.title.params?.locker, "WAW22A")
  assert.equal(c.facts.find((f) => f.slot === "payment")?.value.key, "integration.fact.codLater")
  const noCod = order({ id: "order_01INTEGRATION0000000004", metadata: { allegro_payment_type: "CASH_ON_DELIVERY", inpost_cod: true } })
  s.orders.set(noCod.id, noCod as Row)
  const [d] = await inpostIntegration.build.summaries(makeContext({ scope: s.container }), "order", [noCod.id])
  assert.equal(d.facts.find((f) => f.slot === "payment"), undefined)
})

test("board counters come from one grouped count of the current mode", async () => {
  const s = sample()
  const a = await inpostIntegration.build.attention(makeContext({ scope: s.container }), ["orders"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, c.count]))
  assert.equal(by.parcels_to_create, 1)
  assert.equal(by.parcels_problems, 1)
  assert.equal(by.parcels_failed, 0)
})
