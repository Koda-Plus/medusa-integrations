/**
 * The statistics over the plugin's own rows: cancelled orders never count,
 * nor orders the marketplace only created and nobody paid,
 * the average order value, every day of the window present, the other
 * sales channels by revenue, sell-through and listed offers without a
 * sale, the time to ship (median and p90) and orders late against the days
 * to ship, the delivery, payment and buyer mix with an UNKNOWN bucket,
 * promotion and price program discounts, after sale rates and the top
 * reasons, and what the seller API does not expose named instead of guessed.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { computeStats, NOT_AVAILABLE, quantile, type StatsInput } from "../src/modules/vonhalsky/lib/stats.ts"

const NOW = new Date("2026-10-18T12:00:00Z")

const ORDERS = [
  { id: "o1", placed_at: "2026-10-17T09:00:00Z", remote_status: "ACCEPTED", total_minor: 9999, delivery_minor: 999, delivery_type: "APM", payment_type: "BLIK_CODE", buyer_kind: "PERSON", lines: [{ offer_id: "off-1", quantity: 2, unit_price_minor: 4500 }], paid_at: "2026-10-17T09:00:00Z", shipped_at: "2026-10-17T19:00:00Z", expected_delivery_at: "2026-10-19T19:00:00Z", promotion_discount_minor: 1000, program_discount_minor: 0, refunded_minor: 0, returns_count: 1, claims_count: 0 },
  { id: "o2", placed_at: "2026-10-17T15:00:00Z", remote_status: "ACCEPTED", total_minor: 3000, delivery_minor: 999, delivery_type: "COURIER", payment_type: "CARD", buyer_kind: "COMPANY", lines: [{ offer_id: "off-2", quantity: 1, unit_price_minor: 2001 }], paid_at: "2026-10-17T15:00:00Z", shipped_at: "2026-10-18T11:00:00Z", expected_delivery_at: null, promotion_discount_minor: 0, program_discount_minor: 100, refunded_minor: 3000, returns_count: 0, claims_count: 1 },
  { id: "o3", placed_at: "2026-10-16T08:00:00Z", remote_status: "ACCEPTED", total_minor: 5000, delivery_minor: 999, delivery_type: null, payment_type: "BLIK_CODE", buyer_kind: null, lines: [{ offer_id: "off-1", quantity: 1, unit_price_minor: 4001 }], paid_at: "2026-10-16T08:00:00Z", shipped_at: null, expected_delivery_at: null },
  { id: "o4", placed_at: "2026-10-15T10:00:00Z", remote_status: "ACCEPTED", total_minor: 2000, delivery_minor: 999, delivery_type: "APM", payment_type: "CARD", buyer_kind: "PERSON", lines: [{ offer_id: "off-3", quantity: 1, unit_price_minor: 1001 }], paid_at: "2026-10-17T10:00:00Z", shipped_at: null, expected_delivery_at: null },
  { id: "o5", placed_at: "2026-10-17T10:00:00Z", remote_status: "CANCELED", total_minor: 99_999, delivery_minor: 999, delivery_type: "APM", payment_type: "CARD", buyer_kind: "PERSON", lines: [{ offer_id: "off-4", quantity: 5, unit_price_minor: 19_800 }], paid_at: "2026-10-10T10:00:00Z", shipped_at: null, promotion_discount_minor: 5000, refunded_minor: 99_999, returns_count: 1, claims_count: 1 },
]

const OFFERS = [
  { id: "vhoff_1", status: "listed", remote_id: "off-1", remote_status: "PUBLISHED", stock: 7, title: "Mug", sku: "SKU-1", promotion: { mode: "PERCENTAGE", value: 10 }, program: "IN" },
  { id: "vhoff_2", status: "listed", remote_id: "off-2", remote_status: "SOLDOUT", stock: 0, title: "Plate", sku: "SKU-2" },
  { id: "vhoff_3", status: "listed", remote_id: "off-3", remote_status: "PUBLISHED", stock: 3, title: "Bowl", sku: "SKU-3" },
  { id: "vhoff_4", status: "listed", remote_id: "off-4", remote_status: "PUBLISHED", stock: 10, title: "Jug", sku: "SKU-4" },
  { id: "vhoff_5", status: "listed", remote_id: "off-5", remote_status: "PENDING", stock: 2, title: "Cup", sku: "SKU-5", validation: [{ code: "IMAGES_REQUIRED", message: "Add an image." }] },
  { id: "vhoff_6", status: "blocked", remote_id: null, stock: 5, title: "Saucer", sku: "SKU-6" },
  { id: "vhoff_7", status: "draft", remote_id: null, stock: 1, title: "Spoon", sku: "SKU-7" },
  { id: "vhoff_8", status: "listed", remote_id: "off-8", remote_status: "REJECTED", stock: 0, title: "Knife", sku: "SKU-8", validation: [{ code: "IMAGES_REQUIRED", message: "Add an image again." }, { code: "BANNED", message: null }] },
]

const CASES = [
  { kind: "return", reason: "Zmiana decyzji", lines: [{ offerId: "off-1", quantity: 1 }] },
  { kind: "claim", reason: "Uszkodzony", lines: [{ offerId: "off-2" }] },
  { kind: "return", reason: "Zmiana decyzji", lines: [{ offerId: "off-1", quantity: 2 }] },
  { kind: "refund", reason: null, lines: [] },
  { kind: "return", reason: null, lines: [] },
]

const input = (over: Partial<StatsInput> = {}): StatsInput => ({
  days: 7,
  now: NOW,
  orders: ORDERS,
  offers: OFFERS,
  cases: CASES,
  snapshots: [
    { day: "2026-10-18", data: { published: 3, pending: 1, soldout: 1, closed: 0 } },
    { day: "2026-10-10", data: { published: 9 } },
    { day: "2026-10-12", data: { published: 2, pending: 2 } },
  ],
  otherOrders: [
    { sales_channel_id: "sc_web", total_minor: 5000, created_at: "2026-10-17T10:00:00Z" },
    { sales_channel_id: "sc_web", total_minor: 7000, created_at: "2026-10-16T10:00:00Z" },
    { sales_channel_id: "sc_b2b", total_minor: 20_000, created_at: "2026-10-15T10:00:00Z" },
    { sales_channel_id: null, total_minor: 100, created_at: "2026-10-15T10:00:00Z" },
  ],
  channelNames: new Map([
    ["sc_web", "Sklep"],
    ["sc_b2b", "Hurt"],
  ]),
  daysToShip: 2,
  ...over,
})

const stats = computeStats(input())

test("quantile: the nearest rank of a sorted list, to a tenth", () => {
  assert.equal(quantile([], 0.5), null)
  assert.equal(quantile([5, 1, 3], 0.5), 3)
  assert.equal(quantile([10, 20], 0.5), 10)
  assert.equal(quantile([10, 20], 0.9), 20)
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9)
  assert.equal(quantile([1.234], 0.5), 1.2)
})

test("revenue: cancelled orders are left out, the average order value is rounded to the grosz", () => {
  assert.equal(stats.days, 7)
  assert.equal(stats.from, "2026-10-11T12:00:00.000Z")
  assert.equal(stats.currency, "pln")
  assert.equal(stats.revenue.vonhalsky, "199.99")
  assert.equal(stats.revenue.orders, 4)
  assert.equal(stats.revenue.aov, "50.00")
})

test("revenue: every day of the window is present, empty days too", () => {
  const days = stats.revenue.daily
  assert.equal(days.length, 8)
  assert.equal(days[0].day, "2026-10-11")
  assert.equal(days[days.length - 1].day, "2026-10-18")
  assert.deepEqual(
    days.filter((d) => d.orders > 0),
    [
      { day: "2026-10-15", revenue: "20.00", orders: 1 },
      { day: "2026-10-16", revenue: "50.00", orders: 1 },
      { day: "2026-10-17", revenue: "129.99", orders: 2 },
    ],
  )
  assert.deepEqual(days[0], { day: "2026-10-11", revenue: "0.00", orders: 0 })
})

test("revenue: the other sales channels by revenue, named, an order without a channel too", () => {
  assert.deepEqual(stats.revenue.otherChannels, [
    { id: "sc_b2b", name: "Hurt", revenue: "200.00", orders: 1 },
    { id: "sc_web", name: "Sklep", revenue: "120.00", orders: 2 },
    { id: "none", name: "none", revenue: "1.00", orders: 1 },
  ])
})

test("offers: statuses with the marketplace's view of listed ones", () => {
  assert.deepEqual(stats.offers.byStatus, { PUBLISHED: 3, SOLDOUT: 1, PENDING: 1, BLOCKED: 1, DRAFT: 1, REJECTED: 1 })
  assert.equal(stats.offers.listed, 6)
  assert.equal(stats.offers.withPromotion, 1)
  assert.equal(stats.offers.inProgram, 1)
  assert.equal(stats.offers.pending, 1)
  assert.equal(stats.offers.rejected, 1)
})

test("offers: sell-through is units sold against units sold and in stock", () => {
  /* 5 units sold (cancelled ones not), 22 in stock on listed offers: 5 / 27. */
  assert.equal(stats.offers.sellThrough, 18.5)
})

test("offers: listed offers without a sale, the fullest shelf first", () => {
  assert.equal(stats.offers.noSales, 3)
  assert.deepEqual(stats.offers.noSalesSample, [
    { id: "vhoff_4", title: "Jug", sku: "SKU-4", stock: 10 },
    { id: "vhoff_5", title: "Cup", sku: "SKU-5", stock: 2 },
    { id: "vhoff_8", title: "Knife", sku: "SKU-8", stock: 0 },
  ])
})

test("offers: the most common validation problems of pending and rejected offers", () => {
  assert.deepEqual(stats.offers.topValidation, [
    { code: "IMAGES_REQUIRED", message: "Add an image.", count: 2 },
    { code: "BANNED", message: null, count: 1 },
  ])
})

test("offers: the daily snapshots of the window, oldest first", () => {
  assert.deepEqual(stats.offers.history, [
    { day: "2026-10-12", published: 2, pending: 2, soldout: 0, closed: 0 },
    { day: "2026-10-18", published: 3, pending: 1, soldout: 1, closed: 0 },
  ])
})

test("products: units and revenue per offer with their returns and claims, best first", () => {
  assert.deepEqual(stats.products, [
    { offer_id: "off-1", title: "Mug", sku: "SKU-1", units: 3, revenue: "130.01", returns: 3, claims: 0 },
    { offer_id: "off-2", title: "Plate", sku: "SKU-2", units: 1, revenue: "20.01", returns: 0, claims: 1 },
    { offer_id: "off-3", title: "Bowl", sku: "SKU-3", units: 1, revenue: "10.01", returns: 0, claims: 0 },
  ])
})

test("fulfilment: hours from payment to the first parcel, to the expected delivery, and orders late to ship", () => {
  assert.deepEqual(stats.fulfilment.toShipHours, { median: 10, p90: 20, count: 2 })
  assert.deepEqual(stats.fulfilment.toDeliveryHours, { median: 48, count: 1 })
  assert.equal(stats.fulfilment.late, 1, "paid 52 hours ago and not shipped with 2 days to ship; 26 hours is not late")
  assert.equal(computeStats(input({ daysToShip: 3 })).fulfilment.late, 0)
  assert.equal(computeStats(input({ daysToShip: 1 })).fulfilment.late, 2)
})

test("mix: delivery, payment and buyer of live orders, an unknown value in UNKNOWN", () => {
  assert.deepEqual(stats.mix.delivery, { APM: 2, COURIER: 1, UNKNOWN: 1 })
  assert.deepEqual(stats.mix.payment, { BLIK_CODE: 2, CARD: 2 })
  assert.deepEqual(stats.mix.buyer, { PERSON: 2, COMPANY: 1, UNKNOWN: 1 })
})

test("discounts: promotion and price program, and what discounted orders sold without delivery", () => {
  assert.deepEqual(stats.discounts, { promotion: "10.00", program: "1.00", discountedRevenue: "110.01", discountedUnits: 3 })
})

test("after sale: counts, refunded money, the share of orders with a return or a claim, top reasons", () => {
  assert.equal(stats.afterSale.returns, 3)
  assert.equal(stats.afterSale.claims, 1)
  assert.equal(stats.afterSale.refunds, 1)
  assert.equal(stats.afterSale.refunded, "30.00")
  assert.equal(stats.afterSale.returnRate, 25)
  assert.equal(stats.afterSale.claimRate, 25)
  assert.deepEqual(stats.afterSale.topReasons, [
    { reason: "Zmiana decyzji", count: 2 },
    { reason: "unknown", count: 1 },
    { reason: "Uszkodzony", count: 1 },
  ])
})

test("not available: views, click-through, ratings and payouts are named, never estimated", () => {
  assert.deepEqual(stats.notAvailable, ["views", "ctr", "ratings", "payouts"])
  assert.deepEqual([...NOT_AVAILABLE], stats.notAvailable)
})

test("an empty window has no averages or rates instead of zeros", () => {
  const empty = computeStats(input({ orders: [], offers: [], cases: [], snapshots: [], otherOrders: [] }))
  assert.equal(empty.revenue.vonhalsky, "0.00")
  assert.equal(empty.revenue.orders, 0)
  assert.equal(empty.revenue.aov, null)
  assert.equal(empty.revenue.daily.length, 8)
  assert.equal(empty.offers.sellThrough, null)
  assert.deepEqual(empty.fulfilment.toShipHours, { median: null, p90: null, count: 0 })
  assert.equal(empty.afterSale.returnRate, null)
  assert.equal(empty.afterSale.claimRate, null)
  assert.deepEqual(empty.products, [])
})

test("an order only created and not paid is no sale, a paid or accepted one is", () => {
  const base = ORDERS[3]
  const s = computeStats(
    input({
      orders: [
        { ...base, id: "created-unpaid", remote_status: "CREATED", paid_at: null },
        { ...base, id: "created-paid", remote_status: "CREATED" },
        { ...base, id: "accepted-unpaid", remote_status: "ACCEPTED", paid_at: null },
        { ...base, id: "unknown-unpaid", remote_status: null, paid_at: null },
      ],
    }),
  )
  assert.equal(s.revenue.orders, 2)
  assert.equal(s.revenue.vonhalsky, "40.00")
  assert.deepEqual(s.products.map((p) => [p.offer_id, p.units]), [["off-3", 2]])
})

test("only cancelled orders count as nothing sold", () => {
  const cancelled = computeStats(input({ orders: ORDERS.filter((o) => o.remote_status === "CANCELED").concat([{ ...ORDERS[0], id: "o6", remote_status: "REFUSED" }, { ...ORDERS[0], id: "o7", remote_status: "REJECTED" }]) }))
  assert.equal(cancelled.revenue.orders, 0)
  assert.deepEqual(cancelled.products, [])
  assert.equal(cancelled.discounts.promotion, "0.00")
  assert.equal(cancelled.afterSale.refunded, "0.00")
})
