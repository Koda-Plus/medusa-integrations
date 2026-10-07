import { test } from "node:test"
import assert from "node:assert/strict"
import { periodStats } from "../src/modules/stripe/lib/aggregate.ts"
import { runChecks, summarize } from "../src/modules/stripe/lib/checks.ts"
import { CHECK_KEYS } from "../src/modules/stripe/lib/constants.ts"
import { DashboardLinks } from "../src/modules/stripe/lib/dashboard.ts"
import { buildDemoData, demoAmount, demoFee, demoMethod, demoPaymentForOrder, demoQualifies, hash32, methodOfProvider, type DemoOrder } from "../src/modules/stripe/lib/demo.ts"
import { normalizePaymentIntent, type PaymentFacts } from "../src/modules/stripe/lib/normalize.ts"
import type { CheckKey, PaymentRowDto } from "../src/modules/stripe/lib/contract.ts"
import { paymentsPage } from "../src/workflows/stripe/overview.ts"
import { buildRows, type Snapshot } from "../src/workflows/stripe/snapshot.ts"
import { NOW } from "./fixtures.ts"
import en from "../src/admin/i18n/en.ts"

/** The demo store's orders: Koda Supply, mostly PLN, a few in EUR, totals as Medusa returns them. */
function orders(count = 40): DemoOrder[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `order_FixtureDemo${String(i).padStart(3, "0")}`,
    displayId: 1000 + i,
    createdAt: new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString(),
    total: i % 5 === 0 ? { raw: { value: `${120 + i}.50` }, numeric: 120.5 + i } : `${80 + i * 3}.99`,
    currency: i % 7 === 3 ? "eur" : "pln",
  }))
}

const input = (over: Partial<Parameters<typeof buildDemoData>[0]> = {}) => ({
  orders: orders(),
  now: NOW,
  providerId: "stripe",
  webhookUrl: "https://api.kodasupply.example/hooks/payment/stripe_stripe",
  storefrontDomains: ["kodasupply.example"],
  regions: [{ id: "reg_FixturePL", name: "Polska", currency: "pln" }],
  ...over,
})

function rowsOf(data: ReturnType<typeof buildDemoData>) {
  return buildRows({
    mode: "demo",
    now: NOW,
    paymentIntents: data.paymentIntents,
    refunds: data.refunds,
    disputes: data.disputes,
    balance: data.balance,
    payouts: data.payouts,
    orders: { orderOf: (id) => (id ? (data.sessions.get(id)?.order ?? null) : null), cartOf: (id) => (id ? (data.sessions.get(id)?.cartId ?? null) : null), known: (id) => data.sessions.has(id) },
  })
}

test("deterministic: the same orders give the same account", () => {
  const a = buildDemoData(input())
  const b = buildDemoData(input({ orders: [...orders()].reverse() }))
  assert.deepEqual(JSON.stringify(a.paymentIntents), JSON.stringify(b.paymentIntents))
  assert.deepEqual(JSON.stringify(a.payouts), JSON.stringify(b.payouts))
  assert.equal(hash32("koda"), hash32("koda"))
  assert.equal(demoMethod("pln", "order_x"), demoMethod("pln", "order_x"))
  /* Within an hour nothing moves (the one payment waiting for BLIK is dated from now). */
  const later = buildDemoData(input({ now: new Date(NOW.getTime() + 20 * 60_000) }))
  const stable = (d: ReturnType<typeof buildDemoData>) => d.paymentIntents.filter((p) => p.status !== "requires_action").map((p) => [p.id, p.created])
  assert.deepEqual(stable(later), stable(a))
})

test("every order gets one payment from its own total, every amount is an integer, EUR never pays with BLIK", () => {
  const data = buildDemoData(input())
  assert.equal(data.paymentOfOrder.size, 40)
  for (const p of data.paymentIntents) {
    assert.ok(Number.isSafeInteger(p.amount), String(p.id))
    assert.match(String(p.id), /^pi_Demo/)
    if (p.currency === "eur") {
      const c = p.latest_charge && typeof p.latest_charge === "object" ? p.latest_charge : null
      assert.notEqual(c?.payment_method_details?.type, "blik")
    }
  }
  const first = data.paymentIntents.find((p) => p.id === data.paymentOfOrder.get("order_FixtureDemo001"))
  assert.equal(first?.amount, 8399, "83.99 PLN")
  const big = data.paymentIntents.find((p) => p.id === data.paymentOfOrder.get("order_FixtureDemo005"))
  assert.equal(big?.amount, 12550, "the exact decimal of a BigNumber, 125.50")
  assert.ok(demoFee(10_000, "pln", "blik") > 0)
  assert.ok(Number.isSafeInteger(demoFee(12_345, "pln", "p24")))
})

test("the story: failures, an abandoned checkout, an orphan, a payment waiting for BLIK, one from outside Medusa", () => {
  const data = buildDemoData(input())
  const { payments } = rowsOf(data)
  const by = (f: (p: PaymentRowDto) => boolean) => payments.filter(f)
  assert.ok(by((p) => p.status === "failed").length >= 5)
  assert.ok(by((p) => p.status === "incomplete").length >= 3)
  assert.equal(by((p) => p.status === "requires_action").length, 1)
  assert.equal(by((p) => !p.fromMedusa).length, 1)
  const orphans = by((p) => p.status === "succeeded" && p.fromMedusa && !p.order)
  assert.equal(orphans.length, 1)
  assert.ok(orphans[0].cartId?.startsWith("cart_Demo"))
  assert.ok(payments.every((p) => p.demo))
  const methods = new Set(by((p) => p.status === "succeeded").map((p) => p.method))
  for (const m of ["blik", "card", "p24", "apple_pay", "google_pay"]) assert.ok(methods.has(m as PaymentRowDto["method"]), `no ${m} in the demo`)
})

test("refunds, disputes, balance and payouts hang together", () => {
  const data = buildDemoData(input())
  const r = rowsOf(data)
  assert.equal(r.refunds.length, 3)
  assert.deepEqual(r.refunds.map((x) => x.status).sort(), ["pending", "succeeded", "succeeded"])
  assert.ok(r.refunds.every((x) => x.order !== null), "every refund points at its order")
  assert.equal(r.disputes.length, 3)
  const open = r.disputes.filter((d) => d.open)
  assert.equal(open.length, 2)
  assert.equal(open[0].urgency, "urgent", "the card dispute due in two days comes first")
  assert.equal(r.disputes.find((d) => d.status === "won")?.open, false)
  assert.ok(r.disputes.every((d) => d.method !== "p24"), "Przelewy24 has no disputes")
  const disputedPayments = r.payments.filter((p) => p.disputed)
  assert.equal(disputedPayments.length, 3)
  assert.ok(r.balance && r.balance.pending.some((m) => m.amount > 0), "the last two days are still pending")
  assert.equal(r.balance?.available[0].currency, "pln")
  /* NOW is a Wednesday noon: Tuesday's payout lands on Thursday, Monday's landed this morning. */
  const inTransit = r.payouts.filter((p) => p.status === "in_transit")
  assert.ok(inTransit.length >= 1)
  assert.ok(inTransit.every((p) => p.created.startsWith("2026-10-06")), "only yesterday's payouts are still on their way")
  assert.ok(r.payouts.length >= 10 && r.payouts.length <= 20, "every business day of the sample weeks, at most as many as the live read lists")
  assert.deepEqual([...new Set(r.payouts.map((p) => p.amount.currency))].sort(), ["eur", "pln"], "each currency is paid out on its own")
  const today = Date.UTC(2026, 9, 7)
  for (const p of r.payouts) {
    assert.ok(Number.isSafeInteger(p.amount.amount) && p.amount.amount > 0)
    const created = Date.parse(p.created)
    /* Monday to Friday, before today, landing two business days later. */
    assert.ok(![0, 6].includes(new Date(created).getUTCDay()), p.created)
    assert.ok(created < today, p.created)
    let landing = Date.UTC(new Date(created).getUTCFullYear(), new Date(created).getUTCMonth(), new Date(created).getUTCDate())
    for (let n = 0; n < 2; ) {
      landing += 86_400_000
      if (![0, 6].includes(new Date(landing).getUTCDay())) n++
    }
    assert.equal(p.arrivalDate, new Date(landing).toISOString(), p.id)
  }
})

test("nothing is lost on the way: payouts, available and pending add up to the net minus refunds", () => {
  const data = buildDemoData(input({ orders: orders(12) }))
  assert.ok(data.payouts.length < 20, "a small store, so no payout is cut off by the list limit")
  const charges = data.paymentIntents.filter((p) => p.status === "succeeded").map((p) => (p.latest_charge as { balance_transaction: { net: number; currency: string } }).balance_transaction)
  for (const currency of ["pln", "eur"]) {
    const net = charges.filter((b) => b.currency === currency).reduce((sum, b) => sum + b.net, 0)
    const refunded = data.refunds.filter((x) => x.currency === currency && x.status !== "failed").reduce((sum, x) => sum + Number(x.amount), 0)
    const paidOut = data.payouts.filter((p) => p.currency === currency).reduce((sum, p) => sum + Number(p.amount), 0)
    const held = (list: { amount: number; currency: string }[]) => list.find((m) => m.currency === currency)?.amount ?? 0
    assert.equal(paidOut + held(data.balance.available as { amount: number; currency: string }[]) + held(data.balance.pending as { amount: number; currency: string }[]), net - refunded, currency)
  }
})

test("an order of the last days is paid minutes before it was placed, older ones are moved behind it", () => {
  const DAY = 86_400_000
  const recent: DemoOrder[] = [1, 3, 28].map((days, i) => ({ id: `order_FixtureRecent${i}`, displayId: 2000 + i, createdAt: new Date(NOW.getTime() - days * DAY).toISOString(), total: "99.00", currency: "pln" }))
  const old = orders(10)
  const data = buildDemoData(input({ orders: [...recent, ...old] }))
  for (const o of recent) {
    const pi = data.paymentIntents.find((p) => p.id === data.paymentOfOrder.get(o.id))
    const lead = Date.parse(String(o.createdAt)) - (pi?.created ?? 0) * 1000
    assert.ok(lead >= 60_000 && lead <= 5 * 60_000, `${o.id} paid ${lead} ms before it was placed`)
  }
  const oldestRecent = Date.parse(String(recent[2].createdAt))
  const placed = old.filter((o) => data.paymentOfOrder.has(o.id))
  const left = old.filter((o) => !data.paymentOfOrder.has(o.id))
  assert.ok(placed.length > 0 && left.length > 0, "some fit before the 30 days run out, the rest are left out")
  for (const o of placed) {
    const at = (data.paymentIntents.find((p) => p.id === data.paymentOfOrder.get(o.id))?.created ?? 0) * 1000
    assert.ok(at < oldestRecent && at >= NOW.getTime() - 30 * DAY, o.id)
  }
  /* The order widget still shows a payment for an order left out of the panel, dated at the order. */
  const own = demoPaymentForOrder(data, left[0], NOW)
  const lead = Date.parse(String(left[0].createdAt)) - (own.pi.created ?? 0) * 1000
  assert.ok(lead > 0 && lead <= 5 * 60_000, `paid ${lead} ms before the order`)
})

test("the payments page: a checkout that never got as far as a method is under all methods only, not under Other", () => {
  const r = rowsOf(buildDemoData(input()))
  const snapshot = { ...r, fetchedAt: NOW.toISOString() } as unknown as Snapshot
  const page = paymentsPage(snapshot, { filter: "all", method: "all", q: "", offset: 0, limit: 100 })
  const notChosen = r.payments.filter((p) => p.method === null)
  assert.ok(notChosen.length >= 3, "the abandoned checkouts")
  const pills = Object.values(page.methods).reduce((sum, n) => sum + (n ?? 0), 0)
  assert.equal(pills, page.count - notChosen.length)
  assert.equal(page.methods.other, undefined)
  assert.equal(paymentsPage(snapshot, { filter: "all", method: "other", q: "", offset: 0, limit: 100 }).count, 0)
})

test("every decline the demo shows has its own words in the admin, not Stripe's English", () => {
  const r = rowsOf(buildDemoData(input()))
  const failed = r.payments.filter((p) => p.failure)
  assert.ok(failed.length >= 5)
  for (const p of failed) assert.ok(p.failure?.code && p.failure.code in en.declines, `${p.id}: ${p.failure?.code}`)
  assert.deepEqual([...new Set(failed.map((p) => p.failure?.code))].sort(), ["insufficient_funds", "payment_method_provider_decline"])
})

test("through the same sums as live data: per method volumes add up to the total", () => {
  const r = rowsOf(buildDemoData(input()))
  for (const days of [7, 30]) {
    const p = periodStats({ days, now: NOW, payments: r.payments, refunds: r.refunds, disputes: r.disputes })
    const pln = (list: { amount: number; currency: string }[]) => list.find((m) => m.currency === "pln")?.amount ?? 0
    assert.equal(p.methods.reduce((sum, m) => sum + pln(m.volume), 0), pln(p.volume))
    assert.equal(pln(p.volume) - pln(p.fees), pln(p.net))
    assert.ok(p.successRate !== null && p.successRate > 0.7 && p.successRate < 1)
  }
})

test("through the same checks as live data: a ready account, two deliveries retrying, one payment without an order", () => {
  const data = buildDemoData(input())
  const r = rowsOf(data)
  const facts: PaymentFacts[] = data.paymentIntents.map((p) => normalizePaymentIntent(p, { dashboard: new DashboardLinks("live"), orders: { orderOf: (id) => (id ? (data.sessions.get(id)?.order ?? null) : null), known: (id) => data.sessions.has(id) }, demo: true })!.facts)
  const results = runChecks({
    now: NOW,
    demo: true,
    enabled: Object.fromEntries(CHECK_KEYS.map((k) => [k, true])) as Record<CheckKey, boolean>,
    providerId: "stripe",
    key: { kind: "restricted", mode: "live", last4: null },
    keyFailure: null,
    account: data.account,
    methodConfigs: data.methodConfigs,
    endpoints: data.endpoints,
    failedEvents: data.failedEvents,
    domains: data.domains,
    storefront: { domains: ["kodasupply.example"], source: "option" },
    backendHosts: ["api.kodasupply.example"],
    expectedWebhookUrl: "https://api.kodasupply.example/hooks/payment/stripe_stripe",
    providers: data.providers,
    regions: data.regions,
    payments: facts,
    ordersFailure: null,
    orderOf: () => null,
    balanceCurrencies: ["pln"],
    sessionModes: { live: 10, test: 0 },
    dashboard: new DashboardLinks("live"),
  })
  const verdicts = Object.fromEntries(results.map((x) => [x.key, x.verdict]))
  assert.deepEqual(verdicts, { provider: "pass", key: "pass", account: "pass", capabilities: "pass", webhook: "pass", deliveries: "warn", domains: "pass", regions: "pass", capture: "pass", orphans: "fail" })
  assert.equal(summarize(results).worst, "fail")
  assert.ok(results.every((x) => x.demo))
  assert.equal(r.payments.length, data.paymentIntents.length)
})

test("a store without orders still gets a demo, and a region in PLN when it has none", () => {
  const data = buildDemoData(input({ orders: [], regions: [{ id: "reg_FixtureEU", name: "Europa", currency: "eur" }], storefrontDomains: [] }))
  assert.ok(data.paymentIntents.length >= 3)
  assert.equal(data.regions[0].currency, "pln")
  assert.equal(data.domains[0].domain_name, "shop.example")
  assert.equal(buildDemoData(input({ webhookUrl: null })).endpoints.length, 0)
})

test("the order widget: the panel's payment for a recent order, a payment of its own for an older one", () => {
  const recent: DemoOrder = { id: "order_FixtureRecent", displayId: 99, createdAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(), total: "120.00", currency: "pln" }
  const data = buildDemoData(input({ orders: [recent, ...orders()] }))
  const known = demoPaymentForOrder(data, recent, NOW)!
  assert.equal(known.pi.id, data.paymentOfOrder.get(recent.id))
  assert.equal(known.pi, data.paymentIntents.find((p) => p.id === known.pi.id), "the panel's own object: same refunds, same dispute")
  const old: DemoOrder = { id: "order_FixtureOld", displayId: 7, createdAt: "2025-01-10T10:00:00Z", total: "49.00", currency: "pln" }
  const own = demoPaymentForOrder(data, old, NOW)!
  assert.equal(own.pi.amount, 4900)
  assert.equal(own.pi.status, "succeeded")
  assert.equal(new Date((own.pi.created ?? 0) * 1000).toISOString().slice(0, 10), "2025-01-10")
  assert.equal(own.sessions.get(String(own.pi.metadata?.session_id))?.order?.id, "order_FixtureOld")
})

test("which orders the demo pays: a Stripe payment, or a Stripe session before the payment; never imports, cash on delivery or another gateway", () => {
  const pay = (provider: string) => ({ payment_collections: [{ payments: [{ provider_id: provider }], payment_sessions: [] }] })
  const session = (provider: string) => ({ payment_collections: [{ payments: [], payment_sessions: [{ provider_id: provider }] }] })
  assert.deepEqual(demoQualifies(pay("pp_stripe_stripe"), "stripe"), { ok: true, provider: "pp_stripe_stripe" })
  assert.deepEqual(demoQualifies(session("pp_stripe-blik_stripe"), "stripe"), { ok: true, provider: "pp_stripe-blik_stripe" })
  for (const rule of ["stripe", "stripe-or-none"] as const) {
    assert.equal(demoQualifies(pay("pp_system_default"), rule).ok, false, "an import marked paid")
    assert.equal(demoQualifies(session("pp_cod_cod"), rule).ok, false, "cash on delivery")
    assert.equal(demoQualifies(pay("pp_payu_payu"), rule).ok, false, "another gateway")
    assert.equal(demoQualifies({ payment_collections: [{ payments: [], payment_sessions: [] }] }, rule).ok, false, "an unpaid import has a collection")
    /* The payment decides over an older session of another method. */
    assert.equal(demoQualifies({ payment_collections: [{ payments: [{ provider_id: "pp_system_default" }], payment_sessions: [{ provider_id: "pp_stripe_stripe" }] }] }, rule).ok, false)
  }
  /* No collection at all: only "stripe-or-none" pays it (a demo store seeded without a checkout). */
  assert.equal(demoQualifies({}, "stripe").ok, false)
  assert.equal(demoQualifies({ payment_collections: [] }, "stripe-or-none").ok, true)
  assert.equal(methodOfProvider("pp_stripe-blik_stripe"), "blik")
  assert.equal(methodOfProvider("pp_stripe-przelewy24_stripe"), "p24")
  assert.equal(methodOfProvider("pp_stripe_stripe"), null)
})

test("an order without a total, or below Stripe's minimum charge, gets no sample payment", () => {
  assert.equal(demoAmount({ total: null, currency: "pln" }), null)
  assert.equal(demoAmount({ total: "1.99", currency: "pln" }), null)
  assert.equal(demoAmount({ total: "2.00", currency: "pln" }), 200)
  assert.equal(demoAmount({ total: "0.49", currency: "eur" }), null)
  const data = buildDemoData(input({ orders: [{ id: "order_FixtureFree", displayId: 1, createdAt: NOW.toISOString(), total: "0", currency: "pln" }, ...orders(3)] }))
  assert.equal(data.paymentOfOrder.has("order_FixtureFree"), false)
  assert.equal(demoPaymentForOrder(data, { id: "order_FixtureFree", displayId: 1, createdAt: NOW.toISOString(), total: "0", currency: "pln" }, NOW), null)
})

test("an order the panel moved into its 30 days shows its own payment dated at the order, with the refunds and dispute of the panel's", () => {
  const data = buildDemoData(input())
  assert.ok(data.moved.size > 0, "the fixture orders are months old")
  const disputedId = data.disputes.map((d) => (typeof d.payment_intent === "object" && d.payment_intent ? d.payment_intent.id : d.payment_intent)).find(Boolean)
  const order = orders().find((o) => data.paymentOfOrder.get(o.id) === disputedId)!
  assert.ok(data.moved.has(order.id))
  const shown = data.paymentIntents.find((p) => p.id === disputedId)!
  const own = demoPaymentForOrder(data, order, NOW)!
  assert.equal(own.pi.id, shown.id)
  const placed = Date.parse(String(order.createdAt))
  assert.ok((own.pi.created ?? 0) * 1000 < placed && (own.pi.created ?? 0) * 1000 >= placed - 10 * 60_000, "a few minutes before the order")
  assert.notEqual(own.pi.created, shown.created)
  const charge = own.pi.latest_charge as { disputed?: boolean }
  assert.equal(charge.disputed, true, "the dispute stays with the payment")
})
