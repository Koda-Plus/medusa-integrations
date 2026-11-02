/**
 * The results of the code's e-mails: sends grouped by moment and sender,
 * orders counted for a send only after it and only by its people, delivery
 * shown only when the store reports it, conversion and the orders of others.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { batchesOf, codeMailCampaigns, conversionOf } from "../src/modules/coupons/lib/code-mail-stats.ts"
import { resolveOptions } from "../src/modules/coupons/lib/options.ts"

const T1 = "2026-10-10T09:00:00.000Z"
const T2 = "2026-10-20T09:00:00.000Z"
const e = (customer_id: string, at: string, by: string | null = "office@example.com") => ({ customer_id, email: `${customer_id}@example.com`, at, by })
const order = (orderId: string, customerId: string | null, createdAt: string, revenue: number) => ({ orderId, customerId, createdAt, revenue })

test("one send = the same moment and the same sender, newest first", () => {
  const b = batchesOf([e("cus_a", T1), e("cus_b", T1), e("cus_c", T2, "sales"), e("cus_d", T1, "sales")])
  assert.deepEqual(
    b.map((x) => [x.at, x.by, x.entries.length]),
    [
      [T2, "sales", 1],
      [T1, "office@example.com", 2],
      [T1, "sales", 1],
    ],
  )
})

test("orders count for a send only by its people and only after it", () => {
  const { campaigns, totals } = codeMailCampaigns({
    sent: [e("cus_a", T1), e("cus_b", T1), e("cus_c", T2)],
    orders: [
      order("o1", "cus_a", "2026-10-11T10:00:00.000Z", 100),
      order("o2", "cus_a", "2026-10-15T10:00:00.000Z", 50.5),
      order("o3", "cus_c", "2026-10-19T10:00:00.000Z", 80), // before her send
      order("o4", "cus_x", "2026-10-21T10:00:00.000Z", 40), // never got the e-mail
      order("o5", null, "2026-10-21T10:00:00.000Z", 10), // a guest
    ],
    delivery: null,
  })
  const [second, first] = campaigns
  assert.equal(first.at, T1)
  assert.equal(first.recipients, 2)
  assert.equal(first.buyers, 1)
  assert.equal(first.orders, 2)
  assert.equal(first.revenue, 150.5)
  assert.equal(first.conversion, 50)
  assert.equal(first.delivery, null)
  assert.equal(second.buyers, 0)
  assert.equal(second.revenue, 0)
  assert.equal(second.conversion, 0)
  assert.equal(totals.recipients, 3)
  assert.equal(totals.buyers, 1)
  assert.equal(totals.conversion, 33.3)
  assert.equal(totals.allOrders, 5)
  assert.equal(totals.allRevenue, 280.5)
  assert.equal(totals.otherOrders, 3)
  assert.equal(totals.otherRevenue, 130)
  assert.equal(totals.delivery, null)
})

test("delivery: opened counts as delivered too, bounces apart, unknown people count nowhere", () => {
  const { campaigns, totals } = codeMailCampaigns({
    sent: [e("cus_a", T1), e("cus_b", T1), e("cus_c", T1), e("cus_d", T1)],
    orders: [],
    delivery: { cus_a: "opened", cus_b: "delivered", cus_c: "bounced" },
  })
  assert.deepEqual(campaigns[0].delivery, { delivered: 2, opened: 1, failed: 1 })
  assert.deepEqual(totals.delivery, { delivered: 2, opened: 1, failed: 1 })
})

test("conversion in percent with one decimal, none without people", () => {
  assert.equal(conversionOf(1, 3), 33.3)
  assert.equal(conversionOf(2, 2), 100)
  assert.equal(conversionOf(0, 0), null)
})

test("the store's delivery and revenue adapters are read from the options", () => {
  const read = async () => ({})
  const o = resolveOptions({ orderRevenue: { basis: "net", read }, codeMailDelivery: async () => ({}) })
  assert.equal(o.orderRevenue?.basis, "net")
  assert.equal(typeof o.codeMailDelivery, "function")
  assert.equal(resolveOptions({ orderRevenue: { basis: "net" } as never, codeMailDelivery: 1 as never }).problems.length, 2)
  assert.equal(resolveOptions({ orderRevenue: { basis: "odd" as never, read } }).orderRevenue?.basis, "gross")
})
