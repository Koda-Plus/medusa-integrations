/**
 * BaseLinker in the koda.integration/1 contract: the shared conformance
 * checks on sample rows (orders, products, inventory items), then what this
 * plugin promises: the worst record speaks, the channel, delivery, document,
 * payment and stock facts come from its own rows, external links only to the
 * carriers' tracking pages, skipped orders say why, order metadata changes
 * nothing, and the counters open lists the page really filters.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { baselinkerIntegration } from "../src/workflows/baselinker/integration.ts"
import { makeContext } from "../src/modules/baselinker/lib/kit-routes.ts"
import { BASELINKER_EXTERNAL_HOSTS, exportLine, importLine, sourceName } from "../src/modules/baselinker/lib/integration.ts"
import { setArm } from "../src/workflows/baselinker/settings.ts"
import { conformance } from "./kit-conformance.ts"
import { storeFixture, storeOrder } from "./store.ts"

const TOKEN = "5012345-5067890-QWERTYUIOPASDFGHJKLZXCVBNM1234567890ABCDEFGHIJKLMNOP"
const live = { apiToken: TOKEN, inventoryId: 1, warehouseId: "bl_1", orderStatusId: 1, stockSync: "write" as const }

const SENT = "order_01INTEGRATION0000000001"
const IMPORTED = "order_01INTEGRATION0000000002"
const RETRYING = "order_01INTEGRATION0000000003"
const SKIPPED = "order_01INTEGRATION0000000004"
const WORST = "order_01INTEGRATION0000000005"

function sample(options: Record<string, unknown> = live) {
  const t = storeFixture(options, [
    storeOrder(SENT, 1001),
    /* A shopper's metadata must change nothing. */
    storeOrder(IMPORTED, 1002, { metadata: { baselinker_status_name: "Fake", baselinker_tracking_url: "https://evil.example.com/x" } }),
    storeOrder(RETRYING, 1003),
    storeOrder(SKIPPED, 1004),
    storeOrder(WORST, 1005),
  ])
  const demo = Boolean(options.demo)
  const o = t.s.table("Orders")
  o.create({ order_id: SENT, display_id: 1001, status: "sent", bl_order_id: "7001", attempts: 1, bl_status_name: "Wysłane", tracking_number: "1050500491500U", carrier: "DPD", tracking_url: "https://tracktrace.dpd.com.pl/parcelDetails?p1=1050500491500U", sent_at: "2026-10-06T10:00:00Z", demo })
  o.create({ order_id: RETRYING, display_id: 1003, status: "pending", attempts: 2, last_error_code: "ERROR_NETWORK", next_attempt_at: new Date(Date.now() + 600_000), demo })
  o.create({ order_id: SKIPPED, display_id: 1004, status: "skipped", attempts: 0, last_error_code: "marketplace_order", demo })
  o.create({ order_id: WORST, display_id: 1005, status: "failed", attempts: 14, last_error_code: "ERROR_BAD_PARAMETERS", demo })
  const i = t.s.table("Imports")
  i.create({ bl_order_id: "8001", source: "allegro", external_order_id: "a1b2c3d4", marketplace_ref: "allegro:a1b2c3d4", status: "imported", order_id: IMPORTED, display_id: 1002, payment_state: "cod", bl_status_name: "Nowe", tracking_number: "600000000000000000000001", carrier: "InPost", tracking_url: "https://inpost.pl/sledzenie-przesylek?number=600000000000000000000001", imported_at: "2026-10-06T11:00:00Z", demo })
  i.create({ bl_order_id: "8002", source: "amazon", status: "imported", order_id: WORST, display_id: 1005, payment_state: "paid", imported_at: "2026-10-06T12:00:00Z", demo })
  i.create({ bl_order_id: "8003", source: "allegro", status: "failed", order_id: null, last_error_code: "insufficient_inventory", demo })
  t.s.table("Invoices").create({ document_id: "fdoc_1", order_id: SENT, kind: "vat", number: "FV 12/10/2026", field: "extra_field_1", status: "written", written_at: "2026-10-06T13:00:00Z", demo })

  const p = t.s.table("Products")
  p.create({ bl_product_id: "501", name: "Opona A", sku: "OP-A", match_key: "OP-A", match_source: "sku", variant_id: "var_a", product_id: "prod_a", stock: 3, conflict: null, demo })
  p.create({ bl_product_id: "502", name: "Opona B", sku: "OP-B", match_key: "OP-B", match_source: "sku", variant_id: null, product_id: null, conflict: "duplicate_sku", demo })
  p.create({ bl_product_id: "503", name: "Opona B kopia", sku: "OP-B", match_key: "OP-B", match_source: "sku", variant_id: null, product_id: null, conflict: "duplicate_sku", demo })
  p.create({ bl_product_id: "504", name: "Opona C", sku: "OP-C", match_key: "OP-C", match_source: "sku", variant_id: "var_c", product_id: "prod_c", stock: 7, conflict: null, demo })
  p.create({ bl_product_id: "505", name: "Opona D", sku: "OP-D", match_key: "OP-D", match_source: "sku", variant_id: "var_d", product_id: "prod_d", stock: 9, conflict: null, demo })
  t.s.table("Quarantines").create({ kind: "cards", item_key: "variant:var_c", failures: 3, quarantined_at: new Date(), demo })
  t.s.table("Quarantines").create({ kind: "stock_push", item_key: "card:504", failures: 3, quarantined_at: new Date(), demo })
  t.s.table("StockChanges").create({ variant_id: "var_a", product_id: "prod_a", sku: "OP-A", bl_product_id: "501", inventory_item_id: "iitem_a", location_id: "sloc_1", medusa_stocked: 4, medusa_reserved: 1, bl_stock: 3, target: 4, delta: 0, kind: "update", status: "planned", demo })
  t.s.table("StockChanges").rows[0].delta = -1
  return t
}

{
  for (const entity of ["order", "product", "inventory_item"] as const) {
    const t = sample()
    t.record()
    const knownIds = entity === "order" ? [SENT, IMPORTED, RETRYING, SKIPPED, WORST] : entity === "product" ? ["prod_a", "prod_b", "prod_c"] : ["iitem_a", "iitem_c", "iitem_d"]
    conformance({ routes: baselinkerIntegration, scope: t.container, entity, knownIds, writes: () => [...t.writes, ...t.metadataWrites, ...t.events.map((e) => e.name), ...t.network] })
  }
}

const ctx = (t: ReturnType<typeof sample>, lang: "en" | "pl" = "en") => makeContext({ scope: t.container, lang })

test("orders: sent green with its status, a retry orange, failed red, skipped grey with its reason code", async () => {
  const t = sample()
  const items = await baselinkerIntegration.build.summaries(ctx(t), "order", [SENT, RETRYING, WORST, SKIPPED])
  const [sent, retrying, worst, skipped] = items
  assert.equal(sent.state, "ok")
  assert.equal(sent.title.key, "integration.order.sentStatus")
  assert.equal(sent.title.params?.status, "Wysłane")
  assert.equal(sent.widget, "baselinker.order")
  assert.equal(retrying.state, "attention")
  assert.equal(retrying.detail?.params?.code, "ERROR_NETWORK")
  assert.equal(worst.state, "failed", "the worst record speaks: a failed send beats an import")
  assert.equal(skipped.state, "none")
  assert.equal(skipped.title.key, "integration.order.skip.marketplace_order")
  assert.equal(sent.links[0].href, "/baselinker?section=orders&q=1001")
})

test("an imported order: the channel (BaseLinker and the marketplace, priority 60), cash on delivery and the parcel", async () => {
  const t = sample()
  const [imported] = await baselinkerIntegration.build.summaries(ctx(t, "pl"), "order", [IMPORTED])
  assert.equal(imported.state, "ok")
  const channel = imported.facts.find((f) => f.slot === "channel")
  assert.equal(channel?.code, "baselinker")
  assert.equal(channel?.priority, 60)
  assert.equal(channel?.value.fallback, "BaseLinker: Allegro")
  assert.match(String(channel?.sub?.fallback), /a1b2c3d4/)
  const payment = imported.facts.find((f) => f.slot === "payment")
  assert.equal(payment?.code, "cod")
  const delivery = imported.facts.find((f) => f.slot === "delivery")
  assert.equal(delivery?.priority, 50)
  assert.equal(delivery?.link?.kind, "external")
  assert.match(String(delivery?.link?.href), /^https:\/\/inpost\.pl\//)
  assert.equal(imported.links[0].href, "/baselinker?section=imports&q=8001")
  /* The shopper's metadata (a status name, a link to another site) is nowhere. */
  assert.ok(!JSON.stringify(imported).includes("evil.example.com"))
  assert.ok(!JSON.stringify(imported).includes("Fake"))
})

test("a sent order: the invoice number BaseLinker holds (priority 50, Fakturownia's own document wins with 80), the DPD tracking link", async () => {
  const t = sample()
  const [sent] = await baselinkerIntegration.build.summaries(ctx(t), "order", [SENT])
  const doc = sent.facts.find((f) => f.slot === "document")
  assert.equal(doc?.priority, 50)
  assert.equal(doc?.value.fallback, "Invoice FV 12/10/2026")
  const delivery = sent.facts.find((f) => f.slot === "delivery")
  assert.equal(delivery?.value.fallback, "DPD parcel")
  assert.match(String(delivery?.link?.href), /^https:\/\/tracktrace\.dpd\.com\.pl\//)
  assert.ok(BASELINKER_EXTERNAL_HOSTS.includes("baselinker.com"))
})

test("order metadata changes nothing: an order with baselinker keys in its metadata but no row answers none", async () => {
  const t = storeFixture(live, [storeOrder("order_01INTEGRATION0000000009", 1009, { metadata: { baselinker_order_id: "7009", baselinker_imported: true, marketplace_order_ref: "allegro:x" } })])
  const [none] = await baselinkerIntegration.build.summaries(makeContext({ scope: t.container, lang: "en" }), "order", ["order_01INTEGRATION0000000009"])
  assert.equal(none.state, "none")
  assert.deepEqual(none.facts, [])
})

test("demo rows never link a simulated parcel number to a carrier", async () => {
  const t = sample({ demo: true })
  const [imported] = await baselinkerIntegration.build.summaries(ctx(t), "order", [IMPORTED])
  const delivery = imported.facts.find((f) => f.slot === "delivery")
  assert.ok(delivery)
  assert.equal(delivery?.link, undefined)
  assert.equal(imported.detail?.key, "integration.order.demo")
})

test("products: linked green, a card conflict on its SKU orange, a quarantined plan item red, a stock fact when a stock plan exists", async () => {
  const t = sample()
  const [a, b, c] = await baselinkerIntegration.build.summaries(ctx(t), "product", ["prod_a", "prod_b", "prod_c"])
  assert.equal(a.state, "ok")
  assert.equal(a.title.key, "integration.product.linked")
  assert.equal(a.counts.cards, 1)
  const stock = a.facts.find((f) => f.slot === "stock")
  assert.equal(stock?.value.params?.count, 1)
  assert.equal(b.state, "attention")
  assert.equal(b.title.key, "integration.product.conflict.duplicate_sku")
  assert.equal(b.links[0].href, "/baselinker?section=cards&filter=conflicts&q=OP-B")
  assert.equal(c.state, "failed")
  assert.equal(c.links[0].href, "/baselinker?view=settings&tab=plans&filter=quarantined&q=OP-C")
  assert.equal(a.widget, "baselinker.product")
})

test("inventory items: a difference waits for the stock writer (orange), quarantine red, in step green with the BaseLinker stock", async () => {
  const t = sample()
  const actor = { id: "user_1", label: "anna@example.com" }
  await setArm(t.s.svc, "stockToMedusa", false, actor)
  const [a, c, d] = await baselinkerIntegration.build.summaries(ctx(t), "inventory_item", ["iitem_a", "iitem_c", "iitem_d"])
  assert.equal(a.state, "attention")
  assert.equal(a.detail?.key, "integration.inventory.waitingNotArmed")
  assert.equal(a.facts[0].slot, "stock")
  assert.equal(a.facts[0].value.params?.stock, "3")
  assert.equal(c.state, "failed")
  assert.equal(c.title.key, "integration.inventory.quarantined")
  assert.equal(d.state, "ok")
  assert.equal(d.title.key, "integration.inventory.inStep")
  assert.equal(d.facts[0].value.params?.stock, "9")
  assert.equal(d.widget, null)

  await setArm(t.s.svc, "stockToMedusa", true, actor)
  const [armed] = await baselinkerIntegration.build.summaries(ctx(t), "inventory_item", ["iitem_a"])
  assert.equal(armed.detail?.key, "integration.inventory.waitingArmed")
})

test("counters: failed sends and imports red, quarantine red, card conflicts orange, each opening a list the page filters", async () => {
  const t = sample()
  const res = await baselinkerIntegration.build.attention(ctx(t), ["orders", "products", "inventory"])
  const by = new Map(res.items.map((c) => [c.key, c]))
  assert.deepEqual([...by.keys()].sort(), ["cards_conflict", "imports_failed", "orders_failed", "quarantined"])
  assert.equal(by.get("orders_failed")?.count, 1)
  assert.equal(by.get("orders_failed")?.tone, "red")
  assert.deepEqual(by.get("orders_failed")?.ids, [WORST])
  assert.equal(by.get("orders_failed")?.link.href, "/baselinker?section=orders&filter=failed")
  assert.equal(by.get("imports_failed")?.count, 1)
  assert.equal(by.get("imports_failed")?.link.href, "/baselinker?section=imports&filter=failed")
  assert.equal(by.get("quarantined")?.count, 2)
  assert.equal(by.get("quarantined")?.scope, "inventory")
  assert.equal(by.get("quarantined")?.link.href, "/baselinker?view=settings&tab=plans&filter=quarantined")
  assert.equal(by.get("cards_conflict")?.count, 2)
  assert.equal(by.get("cards_conflict")?.tone, "orange")
  assert.equal(by.get("cards_conflict")?.link.href, "/baselinker?section=cards&filter=conflicts")
  const only = await baselinkerIntegration.build.attention(ctx(t), ["products"])
  assert.deepEqual(only.items.map((c) => c.key), ["cards_conflict"])
})

test("the manifest: three entities, two cards, the carriers and BaseLinker as external hosts, demo said plainly", async () => {
  const t = sample()
  const m = await baselinkerIntegration.build.manifest(ctx(t))
  assert.deepEqual(m.entities, ["order", "product", "inventory_item"])
  assert.deepEqual(m.widgets, [
    { id: "baselinker.order", zone: "order.details" },
    { id: "baselinker.product", zone: "product.details" },
  ])
  assert.equal(m.mode, "live")
  const d = await baselinkerIntegration.build.manifest(ctx(sample({ demo: true })))
  assert.equal(d.mode, "demo")
  assert.ok(d.problems.some((p) => p.key === "integration.problem.demo"))
  const none = storeFixture({})
  none.s.svc.isConfigured = () => false
  none.s.svc.missingOptions = () => ["apiToken", "inventoryId"]
  const off = await baselinkerIntegration.build.manifest(makeContext({ scope: none.container, lang: "en" }))
  assert.equal(off.mode, "off")
  assert.equal(off.configured, false)
  assert.match(off.problems[0].fallback, /apiToken, inventoryId/)
})

test("the lines one by one: every export and import state, and marketplace names", () => {
  const base = { id: "blord_1", order_id: "order_1", display_id: 1, bl_order_id: null, attempts: 0, next_attempt_at: null, last_error: null, last_error_code: null, sent_at: null, bl_status_id: null, bl_status_name: null, tracking_number: null, tracking_url: null, carrier: null, status_checked_at: null, fulfilled_at: null, demo: false }
  assert.equal(exportLine({ ...base, status: "pending" } as never).state, "active")
  assert.equal(exportLine({ ...base, status: "sent", last_error_code: "fulfillment_failed" } as never).state, "attention")
  assert.equal(exportLine({ ...base, status: "skipped", last_error_code: "skip_key" } as never).title.key, "integration.order.skip.skip_key")
  assert.equal(exportLine({ ...base, status: "skipped", last_error_code: "something_else" } as never).title.key, "integration.order.skip.other")
  const imp = { id: "blimp_1", bl_order_id: "1", source: "ebay", status: "imported", flag: "cancel_blocked", last_error_code: null, bl_status_name: null }
  assert.equal(importLine(imp as never).state, "attention")
  assert.equal(importLine({ ...imp, status: "pending", flag: null } as never).state, "active")
  assert.equal(importLine({ ...imp, status: "failed", flag: null } as never).state, "failed")
  assert.equal(sourceName("ebay"), "eBay")
  assert.equal(sourceName("kaufland"), "Kaufland")
  assert.equal(sourceName("newmarket"), "Newmarket")
})
