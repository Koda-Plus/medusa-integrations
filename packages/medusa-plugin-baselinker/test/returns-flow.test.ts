/**
 * Returns, read only: paging by id_from, status and reason names, the link
 * to Medusa orders this plugin sent or imported, and no personal data in the
 * stored rows. Scripted connector.php, in-memory service.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { syncReturns } from "../src/workflows/baselinker/returns.ts"
import { fakeContainer, fakeService, scriptedBaseLinker, silentEvents, type Row } from "./fakes.ts"

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function ret(id: number, orderId: number, over: Row = {}): Row {
  return {
    return_id: id,
    order_id: orderId,
    order_return_source: "allegro",
    status_id: 2,
    date_add: 1_790_000_000,
    date_in_status: 1_790_000_100,
    currency: "pln",
    refunded: "59.99",
    email: "kupujacy@example.com",
    phone: "+48 600 000 000",
    delivery_fullname: "Jan Kowalski",
    delivery_address: "ul. Tajna 1",
    order_return_iban: "PL61109010140000071219812874",
    products: [{ name: "Opona", sku: "OP-1", price_brutto: 59.99, quantity: 1, return_reason_id: 5, return_reason_comment: "Za mała" }],
    ...over,
  }
}

test("live: pages by id_from, names from the lists, linked to our orders, nothing personal stored", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ret(1000 + i, 9000 + i))
  const bl = scriptedBaseLinker({
    getOrderReturnStatusList: () => ({ statuses: [{ id: 2, name: "Przyjęty" }] }),
    getOrderReturnReasonsList: () => ({ return_reasons: [{ return_reason_id: 5, name: "Nie pasuje" }] }),
    getOrderReturns: (p) => ({ returns: p.id_from ? [ret(2000, 555)] : page1 }),
  })
  restore = bl.restore
  const s = fakeService({ apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, orderStatusId: 1, warehouseId: "bl_1" })
  s.table("Orders").create({ order_id: "order_sent", bl_order_id: "9000", status: "sent", demo: false, display_id: 41 })
  s.table("Imports").create({ bl_order_id: "555", order_id: "order_imp", status: "imported", source: "allegro", demo: false, display_id: 42 })
  const container = fakeContainer({ baselinker: s.svc, event_bus: silentEvents().bus })
  const stats = await syncReturns(container, "manual")
  assert.equal(stats?.pages, 2)
  assert.equal(bl.calls.filter((c) => c.method === "getOrderReturns")[1].params.id_from, 1100, "the highest id plus one")
  assert.equal(stats?.created, 101)
  assert.equal(stats?.linked, 2)
  const rows = s.table("Returns").rows
  const linked = rows.filter((r) => r.order_id)
  assert.deepEqual(linked.map((r) => r.order_id).sort(), ["order_imp", "order_sent"])
  const one = rows.find((r) => r.bl_return_id === "2000") as Row
  assert.equal(one.status_name, "Przyjęty")
  assert.equal(one.refunded_minor, 5999)
  assert.deepEqual(one.products, [{ name: "Opona", sku: "OP-1", quantity: 1, price: 59.99, reason: "Nie pasuje" }])
  const stored = JSON.stringify(rows)
  for (const secret of ["kupujacy@example.com", "Kowalski", "Tajna", "PL61109010140000071219812874", "Za mała", "+48 600"]) {
    assert.ok(!stored.includes(secret), `${secret} must not be stored`)
  }
  const again = await syncReturns(container, "schedule")
  assert.equal(again?.created, 0, "a second read only updates what changed")
})

test("demo: returns of imported orders a day after delivery, from the simulated manager", async () => {
  const s = fakeService({ demo: true })
  for (let i = 0; i < 30; i += 1) {
    s.table("Imports").create({ bl_order_id: String(9_200_000 + i), order_id: `order_${i}`, status: "imported", source: "allegro", demo: true, confirmed_at: new Date(Date.now() - 4 * 24 * 3600 * 1000), total_minor: 5000 })
  }
  const container = fakeContainer({ baselinker: s.svc, event_bus: silentEvents().bus })
  const stats = await syncReturns(container, "manual")
  assert.ok((stats?.created ?? 0) > 0)
  assert.ok(s.table("Returns").rows.every((r) => r.demo === true && r.order_id))
  assert.ok(!JSON.stringify(s.table("Returns").rows).includes("example.com"))
})
