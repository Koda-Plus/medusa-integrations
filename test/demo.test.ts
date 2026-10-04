import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DemoBridge, demoQuantity, demoWzFor, sequenceOf, type DemoStore } from "../src/modules/subiekt/lib/demo.ts"
import { BridgeError } from "../src/modules/subiekt/lib/bridge-client.ts"
import type { DocumentRow } from "../src/modules/subiekt/lib/dto.ts"
import type { ContractOrder } from "../src/modules/subiekt/lib/contract.ts"

const order = JSON.parse(readFileSync(new URL("../contract/examples/order-create.request.json", import.meta.url), "utf8")) as ContractOrder

/** In-memory stand-in for the `subiekt_document` table. */
function memoryStore(): DemoStore & { rows: DocumentRow[]; record(doc: Partial<DocumentRow> & { kind: string; number: string }): void } {
  const rows: DocumentRow[] = []
  return {
    rows,
    record(doc) {
      rows.push({
        id: `doc_${rows.length + 1}`,
        order_id: null,
        display_id: null,
        subiekt_id: null,
        status: "open",
        issued_at: new Date(),
        source: "demo",
        warehouse: "MAG",
        related: [],
        event_id: null,
        applied_at: null,
        demo: true,
        ...doc,
      })
    },
    async listDemoDocuments(orderId?: string) {
      return rows.filter((r) => !orderId || r.order_id === orderId)
    },
    async countDemoDocuments(kind: string) {
      return rows.filter((r) => r.kind === kind).length
    },
  }
}

test("a ZK per order, numbered, and the second call returns the same one", async () => {
  const store = memoryStore()
  const now = new Date("2026-10-04T10:00:00Z")
  const bridge = new DemoBridge(store, async () => [], () => now)

  const first = await bridge.createOrder(order)
  assert.equal(first.created, true)
  assert.equal(first.document.number, "ZK 101/MAG/2026")
  store.record({ kind: "ZK", number: first.document.number, order_id: order.order_id, issued_at: now })

  const again = await bridge.createOrder(order)
  assert.equal(again.created, false)
  assert.equal(again.document.number, "ZK 101/MAG/2026")

  const second = await bridge.createOrder({ ...order, order_id: "order_2" })
  assert.equal(second.document.number, "ZK 102/MAG/2026")
})

test("lines without EAN and SKU are refused like a real bridge does", async () => {
  const bridge = new DemoBridge(memoryStore(), async () => [])
  await assert.rejects(
    bridge.createOrder({ ...order, lines: [{ ...order.lines[0], sku: null, ean: null }] }),
    (err: unknown) => err instanceof BridgeError && err.code === "unmatched_lines" && err.retryable === false,
  )
})

test("the warehouse issues a WZ three minutes after the ZK, once, with a stable id", async () => {
  const store = memoryStore()
  const zkTime = new Date("2026-10-04T10:00:00Z")
  store.record({ kind: "ZK", number: "ZK 101/MAG/2026", order_id: "order_1", issued_at: zkTime })

  const early = new DemoBridge(store, async () => [], () => new Date(zkTime.getTime() + 60_000))
  assert.equal((await early.listEvents(0, 100)).events.length, 0)

  const later = new DemoBridge(store, async () => [], () => new Date(zkTime.getTime() + 5 * 60_000))
  const page = await later.listEvents(0, 100)
  assert.equal(page.events.length, 1)
  const event = page.events[0]
  assert.equal(event.type, "document.issued")
  assert.equal(event.data.document?.number, "WZ 301/MAG/2026")
  assert.deepEqual(event.data.document?.related, [{ kind: "ZK", number: "ZK 101/MAG/2026" }])
  assert.equal(event.id, demoWzFor(store.rows[0]).eventId)
  assert.equal(page.last_id, event.id)

  // Past the cursor nothing comes back, and once the WZ is recorded it is not offered again.
  assert.equal((await later.listEvents(event.id, 100)).events.length, 0)
  store.record({ kind: "WZ", number: "WZ 301/MAG/2026", order_id: "order_1" })
  assert.equal((await later.listEvents(0, 100)).events.length, 0)
})

test("cancel: honest about manual work, refused once goods left", async () => {
  const store = memoryStore()
  const bridge = new DemoBridge(store, async () => [])
  assert.equal((await bridge.cancelOrder("order_x")).status, "not_found")

  store.record({ kind: "ZK", number: "ZK 101/MAG/2026", order_id: "order_1" })
  const canceled = await bridge.cancelOrder("order_1")
  assert.equal(canceled.status, "canceled")
  assert.equal(canceled.manual_action_required, true)

  store.record({ kind: "WZ", number: "WZ 301/MAG/2026", order_id: "order_1" })
  await assert.rejects(bridge.cancelOrder("order_1"), (err: unknown) => err instanceof BridgeError && err.code === "document_locked")
})

test("a WZ asked for from Medusa matches the one the feed would announce", async () => {
  const store = memoryStore()
  store.record({ kind: "ZK", number: "ZK 117/MAG/2026", order_id: "order_1" })
  const bridge = new DemoBridge(store, async () => [])
  const res = await bridge.createFulfillment("order_1", { fulfillment_id: "ful_1" })
  assert.equal(res.created, true)
  assert.equal(res.document.number, demoWzFor(store.rows[0]).number)
  await assert.rejects(bridge.createFulfillment("order_none", { fulfillment_id: "ful_2" }), (err: unknown) => err instanceof BridgeError && err.status === 404)
})

test("stock comes from the catalog, stable within a slot, paginated, with Subiekt-only extras", async () => {
  const catalog = Array.from({ length: 30 }, (_, i) => ({ sku: `SKU-${i}`, ean: null, title: `Produkt ${i}` }))
  const now = new Date("2026-10-04T10:00:00Z")
  const bridge = new DemoBridge(memoryStore(), async () => catalog, () => now)
  const first = await bridge.listStock(null, 10)
  assert.equal(first.items.length, 10)
  assert.equal(first.next_cursor, "10")
  const all = []
  let cursor: string | null = null
  do {
    const page = await bridge.listStock(cursor, 10)
    all.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  assert.equal(all.length, first.total)
  assert.ok(all.some((i) => i.symbol.startsWith("SUBIEKT-ONLY")))
  assert.ok(all.length < catalog.length + 3, "some catalog products are missing on purpose")
  for (const item of all) assert.ok(item.available <= item.quantity && item.available >= 0)
  assert.deepEqual(demoQuantity("SKU-1", now), demoQuantity("sku-1", now))
})

test("sequence numbers are read from signatures", () => {
  assert.equal(sequenceOf("ZK 128/MAG/2026"), 128)
  assert.equal(sequenceOf("nonsense"), 0)
})
