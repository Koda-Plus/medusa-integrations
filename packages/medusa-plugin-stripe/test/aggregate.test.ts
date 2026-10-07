import { test } from "node:test"
import assert from "node:assert/strict"
import { effectiveFeeRate, methodShare, ordered, periodStats, rate } from "../src/modules/stripe/lib/aggregate.ts"
import { DashboardLinks } from "../src/modules/stripe/lib/dashboard.ts"
import { attemptFailed, normalizePaymentIntent, normalizeRefund, paymentStatus } from "../src/modules/stripe/lib/normalize.ts"
import type { PaymentRowDto, RefundRowDto } from "../src/modules/stripe/lib/contract.ts"
import { NOW, daysAgo, hoursAgo, pi, refund } from "./fixtures.ts"

const ctx = {
  dashboard: new DashboardLinks("live"),
  orders: { orderOf: (s: string | null | undefined) => (s === "payses_order1" ? { id: "order_Fixture1", displayId: 1001 } : null), cartOf: () => "cart_Fixture" },
  demo: false,
}

function rows(list: ReturnType<typeof pi>[]): PaymentRowDto[] {
  return list.map((p) => normalizePaymentIntent(p, ctx)?.row).filter((r): r is PaymentRowDto => Boolean(r))
}

test("a PaymentIntent becomes a row: status, method, fee and net from the balance transaction, the order by session", () => {
  const raw = pi({ amount: 19_999, method: { type: "blik" }, fee: 420, sessionId: "payses_order1", created: hoursAgo(2) })
  const n = normalizePaymentIntent(raw, ctx)
  assert.ok(n)
  const r = n.row
  assert.equal(r.status, "succeeded")
  assert.equal(r.method, "blik")
  assert.deepEqual(r.amount, { amount: 19_999, currency: "pln" })
  assert.deepEqual(r.received, { amount: 19_999, currency: "pln" })
  assert.deepEqual(r.fee, { amount: 420, currency: "pln" })
  assert.deepEqual(r.net, { amount: 19_579, currency: "pln" })
  assert.deepEqual(r.order, { id: "order_Fixture1", displayId: 1001 })
  assert.equal(r.cartId, null)
  assert.equal(r.fromMedusa, true)
  assert.equal(r.risk, "not_assessed")
  assert.equal(r.dashboardUrl, `https://dashboard.stripe.com/payments/${raw.id}`)
  assert.equal(n.facts.automatic, true)
  assert.deepEqual(n.facts.methodTypes, ["card", "blik", "p24", "link"])

  const outside = normalizePaymentIntent(pi({ amount: 5000, sessionId: null }), ctx)
  assert.equal(outside?.row.fromMedusa, false)
  const orphan = normalizePaymentIntent(pi({ amount: 5000, sessionId: "payses_unknown" }), ctx)
  assert.equal(orphan?.row.order, null)
  assert.equal(orphan?.row.cartId, "cart_Fixture")

  const test = normalizePaymentIntent(pi({ amount: 100 }), { ...ctx, dashboard: new DashboardLinks("test") })
  assert.match(String(test?.row.dashboardUrl), /^https:\/\/dashboard\.stripe\.com\/test\/payments\/pi_/)

  assert.equal(normalizePaymentIntent({ id: "pi_x", amount: 12.5, currency: "pln" }, ctx), null, "a float amount is not a payment")
})

test("statuses in one word, and a declined attempt counts as failed even after a cancel", () => {
  assert.equal(paymentStatus({ status: "requires_capture" }), "authorized")
  assert.equal(paymentStatus({ status: "requires_payment_method" }), "incomplete")
  assert.equal(paymentStatus({ status: "requires_payment_method", last_payment_error: { code: "card_declined" } }), "failed")
  assert.equal(paymentStatus({ status: "requires_confirmation" }), "incomplete")
  assert.equal(paymentStatus({ status: "processing" }), "processing")
  const canceled = normalizePaymentIntent(pi({ amount: 1000, status: "canceled", error: { code: "card_declined", decline_code: "insufficient_funds" } }), ctx)?.row
  assert.ok(canceled)
  assert.equal(canceled.status, "canceled")
  assert.equal(canceled.failure?.code, "insufficient_funds")
  assert.equal(attemptFailed(canceled), true)
})

test("periods: integer sums per currency, fees in the settlement currency, rates without abandoned checkouts", () => {
  const list = rows([
    pi({ amount: 10_000, method: { type: "blik" }, fee: 260, created: hoursAgo(5) }),
    pi({ amount: 20_000, method: { type: "card", wallet: "apple_pay" }, fee: 400, created: daysAgo(2) }),
    pi({ amount: 5_000, method: { type: "p24" }, fee: 210, created: daysAgo(6) }),
    pi({ amount: 30_000, method: { type: "card" }, fee: 550, created: daysAgo(12) }),
    pi({ amount: 4_000, currency: "eur", method: { type: "card" }, fee: 85, created: daysAgo(20) }),
    /* Settled in EUR although paid in PLN: the fee lands in EUR. */
    pi({ amount: 8_000, method: { type: "card" }, fee: 50, feeCurrency: "eur", created: daysAgo(25) }),
    /* Succeeded, fee not settled yet. */
    pi({ amount: 1_500, method: { type: "blik" }, fee: null, created: hoursAgo(1) }),
    pi({ amount: 9_000, status: "requires_payment_method", error: { method: { type: "card" } }, created: daysAgo(1) }),
    pi({ amount: 9_000, status: "requires_payment_method", created: daysAgo(1) }),
    pi({ amount: 2_000, status: "requires_capture", method: { type: "card" }, created: daysAgo(3) }),
    pi({ amount: 2_000, status: "processing", created: daysAgo(3) }),
    pi({ amount: 99_999, created: daysAgo(31) }),
  ])
  const refunds = [refund(pi({ amount: 20_000 }), 5_000, { created: Math.floor(hoursAgo(3).getTime() / 1000) }), refund(pi({ amount: 1_000 }), 1_000, { status: "failed" })]
    .map((r) => normalizeRefund(r, ctx))
    .filter((r): r is RefundRowDto => Boolean(r))

  const week = periodStats({ days: 7, now: NOW, payments: list, refunds, disputes: [] })
  assert.equal(week.succeeded, 4)
  assert.equal(week.failed, 1)
  assert.equal(week.authorized, 1)
  assert.equal(week.processing, 1)
  assert.equal(week.incomplete, 1)
  assert.equal(week.successRate, 4 / 5)
  assert.deepEqual(week.volume, [{ amount: 36_500, currency: "pln" }])
  assert.deepEqual(week.fees, [{ amount: 870, currency: "pln" }])
  assert.deepEqual(week.net, [{ amount: 34_130, currency: "pln" }])
  assert.equal(week.feesPending, 1)
  assert.deepEqual(week.refunded, [{ amount: 5_000, currency: "pln" }])
  assert.equal(week.refunds, 1)
  assert.deepEqual(
    week.methods.map((m) => [m.method, m.count, m.failed]),
    /* By count, then by the order of the methods in a Polish store: BLIK, card, Przelewy24, the wallets. */
    [
      ["blik", 2, 0],
      ["p24", 1, 0],
      ["apple_pay", 1, 0],
      ["card", 0, 1],
    ],
  )
  const blik = week.methods.find((m) => m.method === "blik")
  assert.deepEqual(blik?.volume, [{ amount: 11_500, currency: "pln" }])
  assert.deepEqual(blik?.fees, [{ amount: 260, currency: "pln" }])
  assert.equal(methodShare(week, blik!), 2 / 4)

  const month = periodStats({ days: 30, now: NOW, payments: list, refunds, disputes: [] })
  assert.equal(month.succeeded, 7)
  assert.deepEqual(month.volume, [
    { amount: 74_500, currency: "pln" },
    { amount: 4_000, currency: "eur" },
  ])
  assert.deepEqual(month.fees, [
    { amount: 1_420, currency: "pln" },
    { amount: 135, currency: "eur" },
  ])
  /* Every sum is an integer. */
  for (const m of [...month.volume, ...month.fees, ...month.net]) assert.ok(Number.isSafeInteger(m.amount))
  assert.equal(effectiveFeeRate(week), 870 / 36_500)
  assert.equal(effectiveFeeRate(month), null, "a fee rate across currencies means nothing")
  assert.equal(month.partial, false)
  assert.equal(periodStats({ days: 30, now: NOW, payments: list, refunds: [], disputes: [], coveredFrom: daysAgo(10).getTime() }).partial, true)
  assert.equal(periodStats({ days: 7, now: NOW, payments: list, refunds: [], disputes: [], coveredFrom: daysAgo(10).getTime() }).partial, false)
})

test("one currency order for a whole period: every method lists its currencies the way the total does", () => {
  const list = rows([
    pi({ amount: 50_000, method: { type: "blik" }, fee: 800, created: daysAgo(2) }),
    pi({ amount: 3_000, method: { type: "link" }, fee: 90, created: daysAgo(3) }),
    pi({ amount: 9_000, currency: "eur", method: { type: "link" }, fee: 160, created: daysAgo(4) }),
  ])
  const month = periodStats({ days: 30, now: NOW, payments: list, refunds: [], disputes: [] })
  assert.deepEqual(
    month.volume.map((m) => m.currency),
    ["pln", "eur"],
  )
  const link = month.methods.find((m) => m.method === "link")
  assert.deepEqual(
    link?.volume,
    [
      { amount: 3_000, currency: "pln" },
      { amount: 9_000, currency: "eur" },
    ],
    "PLN first, as in the total, although the EUR number is larger",
  )
  assert.deepEqual(
    link?.fees.map((m) => m.currency),
    ["pln", "eur"],
  )
  assert.deepEqual(
    ordered(
      [
        { amount: 1, currency: "usd" },
        { amount: 5, currency: "eur" },
        { amount: 2, currency: "pln" },
      ],
      ["pln"],
    ).map((m) => m.currency),
    ["pln", "eur", "usd"],
  )
})

test("rates", () => {
  assert.equal(rate(0, 0), null)
  assert.equal(rate(9, 1), 0.9)
  const empty = periodStats({ days: 7, now: NOW, payments: [], refunds: [], disputes: [] })
  assert.equal(empty.successRate, null)
  assert.deepEqual(empty.volume, [])
  assert.deepEqual(empty.methods, [])
})
