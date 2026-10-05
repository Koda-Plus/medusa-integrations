import { test } from "node:test"
import assert from "node:assert/strict"
import { parseProductsList } from "../src/modules/baselinker/lib/catalog.ts"
import {
  DEMO_ORDER_ID_BASE,
  DEMO_WAREHOUSE_ID,
  buildDemoProducts,
  demoOrder,
  demoPace,
  demoTrackingNumber,
  nextDemoOrderId,
  type DemoVariant,
} from "../src/modules/baselinker/lib/demo.ts"
import { matchCards } from "../src/modules/baselinker/lib/matching.ts"

const catalog: DemoVariant[] = Array.from({ length: 24 }, (_, i) => ({
  sku: `KP-${String(i).padStart(3, "0")}`,
  ean: i === 5 ? "5901234123457" : null,
  title: `Produkt ${i}`,
  available: i % 3 === 0 ? null : 5 + (i % 4),
  price: 100 + i,
}))

test("the simulated catalog is deterministic", () => {
  const first = buildDemoProducts(catalog)
  const second = buildDemoProducts([...catalog].reverse())
  assert.deepEqual(first, second)
  assert.equal(new Set(Object.keys(first)).size, Object.keys(first).length)
})

test("it shows every case the admin should: duplicate SKU, no SKU, only in BaseLinker, EAN link, missing variants", () => {
  const { cards } = parseProductsList(buildDemoProducts(catalog), DEMO_WAREHOUSE_ID)
  const variants = catalog.map((v) => ({ id: `var_${v.sku}`, productId: "prod", sku: v.sku, codes: [v.ean], productTitle: v.title }))
  const { matches, summary } = matchCards(cards, variants)
  assert.equal(summary.duplicateSku, 2)
  assert.ok(summary.noSku >= 1)
  assert.ok(summary.unmatched >= 3, "two cards only in BaseLinker plus the card without a SKU")
  assert.equal(summary.linkedByEan, 1)
  assert.ok(summary.onlyInMedusa >= 1, "a few variants are missing in BaseLinker")
  assert.ok(summary.linked > catalog.length / 2, "most variants have a card")
  assert.ok(cards.some((c) => c.stock === -1), "one card is negative, for the clamp")
  const viaEan = [...matches.values()].find((m) => m.source === "ean" && m.variant)
  assert.equal(viaEan?.variant?.sku, "KP-005")
})

test("stock equals Medusa for most cards and differs for some, so the plan has rows", () => {
  const { cards } = parseProductsList(buildDemoProducts(catalog), DEMO_WAREHOUSE_ID)
  const bySku = new Map(cards.map((c) => [c.sku, c.stock]))
  const known = catalog.filter((v) => v.available !== null && bySku.has(v.sku))
  const equal = known.filter((v) => bySku.get(v.sku) === v.available).length
  assert.ok(equal > 0 && equal < known.length)
})

test("the simulated warehouse moves an order on: Nowe, W realizacji, Wysłane with an InPost number", () => {
  const sentAt = new Date("2026-10-05T10:00:00Z")
  const pace = demoPace("order_1")
  const at = (s: number) => demoOrder({ blOrderId: "9100001", orderId: "order_1", sentAt, now: new Date(sentAt.getTime() + s * 1000 * pace) })
  assert.equal(at(10).order_status_id, 100001)
  assert.equal(at(10).delivery_package_nr, "")
  assert.equal(at(90).order_status_id, 100002)
  assert.equal(at(200 + 6 * 3600).order_status_id, 100004)
  const shipped = at(200)
  assert.equal(shipped.order_status_id, 100003)
  assert.equal(shipped.delivery_package_module, "inpost")
  assert.match(shipped.delivery_package_nr, /^\d{24}$/)
  assert.equal(shipped.delivery_package_nr, demoTrackingNumber("order_1"))
  assert.equal(shipped.admin_comments, "[medusa:order_1]")
})

test("the warehouse pace differs between orders, from 1x to 8x", () => {
  const paces = new Set(Array.from({ length: 40 }, (_, i) => demoPace(`order_${i}`)))
  assert.ok(paces.size >= 3)
  for (const p of paces) assert.ok([1, 2, 4, 8].includes(p))
})

test("0.2: variants of one product become variant cards of a main card; the bundle, the EAN pair and the details are there", async () => {
  const { buildDemoDetails, demoNewCardId, demoPrice } = await import("../src/modules/baselinker/lib/demo.ts")
  const { parseProductsData, containerIds } = await import("../src/modules/baselinker/lib/catalog.ts")
  const grouped: DemoVariant[] = catalog.map((v, i) => ({ ...v, productId: i < 3 ? "prod_jacket" : `prod_${i}`, productTitle: i < 3 ? "Kurtka" : v.title, variantTitle: i < 3 ? `R${i}` : null, category: "Odzież" }))
  const list = buildDemoProducts(grouped)
  const { cards } = parseProductsList(list, DEMO_WAREHOUSE_ID)
  const parents = containerIds(cards)
  assert.ok(parents.size >= 2, "the jacket and the gloves only in BaseLinker")
  const details = parseProductsData(buildDemoDetails(grouped, list).products)
  const jacket = details.find((d) => d.name === "Kurtka")
  assert.ok(jacket && jacket.variants.length >= 2)
  assert.equal(jacket?.variants[0].name.startsWith("R"), true)
  assert.ok(details.some((d) => d.isBundle))
  const eans = cards.map((c) => c.ean).filter((e) => e === "5906660000038")
  assert.equal(eans.length, 2, "one EAN on two cards")
  assert.ok(catalog.some((v) => demoPrice(v) !== v.price), "some prices differ, for the price plans")

  /* What the simulated writers did is part of the next read. */
  const overlay = { cards: { var_x: { blId: demoNewCardId("var_x"), sku: "NEW-1", name: "Nowa karta", ean: null } }, stock: {}, prices: {} }
  const next = parseProductsList(buildDemoProducts(grouped, overlay), DEMO_WAREHOUSE_ID).cards
  assert.ok(next.some((c) => c.sku === "NEW-1" && c.blProductId === demoNewCardId("var_x")))
  const anyCard = cards.find((c) => c.sku === catalog[0].sku) as { blProductId: string }
  const moved = parseProductsList(buildDemoProducts(grouped, { stock: { [anyCard.blProductId]: 77 }, prices: { [anyCard.blProductId]: 1.5 } }), DEMO_WAREHOUSE_ID).cards
  const after = moved.find((c) => c.blProductId === anyCard.blProductId)
  assert.equal(after?.stock, 77)
  assert.deepEqual(after?.prices, { "1001": 1.5 })
})

test("simulated BaseLinker order ids start at 9100001 and follow the highest one", () => {
  assert.equal(nextDemoOrderId(null), DEMO_ORDER_ID_BASE + 1)
  assert.equal(nextDemoOrderId(9_100_041), 9_100_042)
  assert.equal(nextDemoOrderId(17), DEMO_ORDER_ID_BASE + 1)
})
