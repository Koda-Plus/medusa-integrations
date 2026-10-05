import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DEMO_CLOCK_SKEW_MS, DemoBridge, demoEan, demoKsefFor, demoQuantity, demoRetailPrice, demoWzFor, sequenceOf, type DemoStore } from "../src/modules/subiekt/lib/demo.ts"
import { BridgeError } from "../src/modules/subiekt/lib/bridge-client.ts"
import type { DocumentRow } from "../src/modules/subiekt/lib/dto.ts"
import type { ContractOrder, ProductItem } from "../src/modules/subiekt/lib/contract.ts"

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

test("demo health speaks contract 1.1: every capability, versions, a small clock skew", async () => {
  const now = new Date("2026-10-04T10:00:00Z")
  const h = await new DemoBridge(memoryStore(), async () => [], () => now).health()
  assert.equal(h.bridge.contract, "1.1.0")
  for (const c of ["products", "contractors.create", "documents.fs", "documents.pa", "documents.ksef"]) assert.ok(h.capabilities?.includes(c), c)
  assert.equal(h.subiekt.database_version, h.bridge.sdk_version)
  assert.equal(h.subiekt.licence, "ok")
  assert.equal(Date.parse(h.time) - now.getTime(), DEMO_CLOCK_SKEW_MS)
})

test("demo products come from the catalog with two price levels, a conflict and Subiekt-only items", async () => {
  const catalog = Array.from({ length: 30 }, (_, i) => ({ sku: `SKU-${i}`, ean: i === 3 ? "5901234123457" : null, title: `Produkt ${i}`, price: 100 + i, weight: 250 }))
  const bridge = new DemoBridge(memoryStore(), async () => catalog, () => new Date("2026-10-04T10:00:00Z"))
  const all: ProductItem[] = []
  let cursor: string | null = null
  let levels: string[] = []
  do {
    const page = await bridge.listProducts(cursor, 10)
    levels = page.price_levels.map((l) => l.symbol)
    all.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  assert.deepEqual(levels, ["DETAL", "HURT"])
  const eans = all.map((p) => p.ean).filter(Boolean)
  assert.ok(eans.length > new Set(eans).size, "two products share one EAN")
  assert.ok(all.some((p) => p.kind === "kit"))
  assert.ok(all.some((p) => !p.active))
  for (const p of all) {
    if (p.prices.length === 0) continue
    const retail = p.prices.find((x) => x.level === "DETAL")!
    const wholesale = p.prices.find((x) => x.level === "HURT")!
    assert.ok(wholesale.gross < retail.gross)
    assert.ok(retail.net < retail.gross)
  }
  const changed = catalog.filter((c) => demoRetailPrice(c.sku, c.price) !== c.price)
  assert.ok(changed.length > 0 && changed.length < catalog.length, "some prices differ from Medusa, most do not")
  assert.equal(demoEan("x").length, 13)
})

test("demo sales documents: numbered per kind, one per order, KSeF two minutes later", async () => {
  const store = memoryStore()
  const issued = new Date("2026-10-04T10:00:00Z")
  store.record({ kind: "ZK", number: "ZK 101/MAG/2026", order_id: "order_1", issued_at: issued })
  const bridge = new DemoBridge(store, async () => [], () => issued)

  const fs = await bridge.issueDocument("order_1", { kind: "fs", display_id: 1001 })
  assert.equal(fs.created, true)
  assert.equal(fs.document.number, "FS 41/MAG/2026")
  assert.deepEqual(fs.document.related, [{ kind: "ZK", number: "ZK 101/MAG/2026" }])
  store.record({ kind: "FS", number: fs.document.number, order_id: "order_1", issued_at: issued })

  const again = await bridge.issueDocument("order_1", { kind: "pa" })
  assert.equal(again.created, false)
  assert.equal(again.document.number, "FS 41/MAG/2026")
  assert.match(again.warnings?.[0] ?? "", /PA was not created/)
  await assert.rejects(bridge.issueDocument("order_none", { kind: "fs" }), (err: unknown) => err instanceof BridgeError && err.code === "order_not_found" && err.retryable)
  await assert.rejects(bridge.cancelOrder("order_1"), (err: unknown) => err instanceof BridgeError && err.code === "document_locked")

  const early = await new DemoBridge(store, async () => [], () => new Date(issued.getTime() + 60_000)).listEvents(0, 100)
  assert.equal(early.events.filter((e) => e.type === "document.updated").length, 0)
  const later = await new DemoBridge(store, async () => [], () => new Date(issued.getTime() + 3 * 60_000)).listEvents(0, 100)
  const updated = later.events.filter((e) => e.type === "document.updated")
  assert.equal(updated.length, 1)
  assert.equal(updated[0].data.document?.ksef_number, demoKsefFor(store.rows[1]).ksef)
  assert.match(updated[0].data.document?.ksef_number ?? "", /^5265877635-20261004-[0-9A-F]{12}-[0-9A-F]{2}$/)
})

test("demo buyers: some NIPs exist, others are created only when asked", async () => {
  const bridge = new DemoBridge(memoryStore(), async () => [])
  const results = await Promise.all(
    ["1234563218", "5265877635", "7740001454", "5213017228", "9542751368"].map((nip) =>
      bridge.createOrder({ ...order, order_id: `order_${nip}`, buyer: { nip, company_name: "Firma", address: null, email: null, phone: null, create_if_missing: false } }),
    ),
  )
  const sources = new Set(results.map((r) => r.buyer?.source))
  assert.ok(sources.has("retail"))
  for (const r of results.filter((x) => x.buyer?.source === "retail")) assert.match(r.warnings?.[0] ?? "", /retail buyer/)
  const created = await bridge.createOrder({ ...order, order_id: "order_new", buyer: { nip: "5265877635", company_name: "X", address: null, email: null, phone: null, create_if_missing: true } })
  assert.ok(["created", "existing"].includes(created.buyer?.source ?? ""))
  assert.equal((await bridge.createOrder({ ...order, order_id: "order_plain" })).buyer?.source, "retail")
})
