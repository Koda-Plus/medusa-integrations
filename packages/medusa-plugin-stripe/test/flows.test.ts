/**
 * The reads end to end: the real flows (snapshot, overview, payments page,
 * checks, order widget, status) against a fake Medusa container (Query, the
 * payment module, the config) and a scripted Stripe client. No network:
 * `fetch` is replaced for the whole file and refuses every call.
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { StripeApiError } from "../src/modules/stripe/lib/errors.ts"
import { buildStatus } from "../src/api/admin/stripe/helpers.ts"
import { loadStripeOrder, loadStripeOverview, runStripeChecks } from "../src/workflows/stripe/reads.ts"
import { paymentsPage } from "../src/workflows/stripe/overview.ts"
import { cacheFor, requestOrigin, setCacheForTests } from "../src/workflows/stripe/runtime.ts"
import { loadOrderPayments } from "../src/workflows/stripe/order.ts"
import { TtlCache } from "../src/modules/stripe/lib/cache.ts"
import { loadSnapshot } from "../src/workflows/stripe/snapshot.ts"
import { NOW, READ_KEY, account, bt, dispute, domain, endpoint, methodConfig, pi, refund } from "./fixtures.ts"
import { FakeStripe, PROVIDERS, REGIONS, RefusingStripe, container, type MedusaData } from "./harness.ts"

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network in tests")
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000)

/** A live store: two orders paid (BLIK, Apple Pay), a paid cart without an order, a declined card, a payment link. */
function liveStore() {
  const blik = pi({ amount: 24_900, method: { type: "blik" }, fee: 498, sessionId: "payses_order1", created: ago(2) })
  const apple = pi({ amount: 15_000, method: { type: "card", wallet: "apple_pay" }, fee: 325, sessionId: "payses_order2", created: ago(30), disputed: true })
  const orphan = pi({ amount: 9_900, method: { type: "blik" }, fee: 258, sessionId: "payses_lost", created: ago(3) })
  const declined = pi({ amount: 5_000, status: "requires_payment_method", error: { code: "card_declined", decline_code: "insufficient_funds", method: { type: "card" } }, sessionId: "payses_cart3", created: ago(5) })
  const link = pi({ amount: 35_000, method: { type: "card" }, fee: 625, sessionId: null, created: ago(50) })
  const stripe = new FakeStripe({
    "/payment_intents": () => [blik, orphan, declined, apple, link],
    "/refunds": () => [refund(apple, 5_000, { created: Math.floor(ago(1).getTime() / 1000) })],
    "/disputes": () => [dispute(apple, { dueInHours: 40 })],
    "/balance": () => ({ available: [{ amount: 12_000, currency: "pln" }], pending: [{ amount: 33_000, currency: "pln" }] }),
    "/payouts": () => [{ id: "po_FixtureA", amount: 50_000, currency: "pln", created: Math.floor(ago(48).getTime() / 1000), arrival_date: Math.floor(ago(24).getTime() / 1000), status: "paid", method: "standard", automatic: true }],
    "/account": () => account(),
    "/payment_method_configurations": () => [methodConfig()],
    "/webhook_endpoints": () => [endpoint()],
    "/events": () => [],
    "/payment_method_domains": () => [domain("kodasupply.example"), domain("www.kodasupply.example")],
  })
  const medusa: MedusaData = {
    sessions: {
      payses_order1: { orderId: "order_Fixture1", displayId: 1001 },
      payses_order2: { orderId: "order_Fixture2", displayId: 1002 },
      payses_lost: { cartId: "cart_FixtureLost" },
      payses_cart3: { cartId: "cart_Fixture3" },
    },
    sessionModes: [{ livemode: true }, { livemode: true }],
    regions: REGIONS,
    providers: PROVIDERS,
    storeCors: "http://localhost:8000,https://kodasupply.example,https://www.kodasupply.example",
  }
  return { stripe, medusa, payments: { blik, apple, orphan, declined, link } }
}

/* ------------------------------------------------------------------ */

test("live: one read of Stripe, payments matched to their orders by the payment session, then the cache", async () => {
  const { stripe, medusa, payments } = liveStore()
  const c = container({ apiKey: READ_KEY }, medusa, stripe)
  const overview = await loadStripeOverview(c)
  assert.equal(overview.mode, "live")
  assert.equal(overview.configured, true)
  assert.equal(overview.fresh, true)
  assert.equal(overview.paymentsTotal, 5)
  const byId = new Map(overview.payments.map((p) => [p.id, p]))
  assert.deepEqual(byId.get(String(payments.blik.id))?.order, { id: "order_Fixture1", displayId: 1001 })
  assert.equal(byId.get(String(payments.orphan.id))?.cartId, "cart_FixtureLost")
  assert.equal(byId.get(String(payments.link.id))?.fromMedusa, false)
  assert.equal(byId.get(String(payments.declined.id))?.status, "failed")

  const week = overview.periods.find((p) => p.days === 7)!
  assert.equal(week.succeeded, 4)
  assert.equal(week.failed, 1)
  assert.deepEqual(week.volume, [{ amount: 24_900 + 15_000 + 9_900 + 35_000, currency: "pln" }])
  assert.deepEqual(week.fees, [{ amount: 498 + 325 + 258 + 625, currency: "pln" }])
  assert.deepEqual(week.refunded, [{ amount: 5_000, currency: "pln" }])
  assert.equal(overview.disputes.length, 1)
  assert.deepEqual(overview.disputes[0].order, { id: "order_Fixture2", displayId: 1002 })
  assert.deepEqual(overview.refunds[0].order, { id: "order_Fixture2", displayId: 1002 })
  assert.deepEqual(overview.balance, { available: [{ amount: 12_000, currency: "pln" }], pending: [{ amount: 33_000, currency: "pln" }] })
  assert.equal(overview.payouts.past.length, 1)
  assert.deepEqual(overview.errors, [])

  /* The parameters Stripe gets: 30 days, the charge and its balance transaction expanded. */
  const list = stripe.calls.find((x) => x.path === "/payment_intents")
  assert.deepEqual((list?.params as { expand: string[] }).expand, ["data.latest_charge.balance_transaction"])
  assert.ok(typeof (list?.params as { created: { gte: number } }).created.gte === "number")
  /* Disputes from 180 days back: an open dispute of a payment older than the panel's 30 days still shows. */
  const disputes = stripe.calls.find((x) => x.path === "/disputes")?.params as { created: { gte: number } }
  assert.ok(Math.abs(disputes.created.gte - (Date.now() / 1000 - 180 * 86_400)) < 120)

  const again = await loadStripeOverview(c)
  assert.equal(again.fresh, false)
  assert.equal(stripe.count("/payment_intents"), 1, "served from the cache")
  const forced = await loadStripeOverview(c, { force: true })
  assert.equal(forced.fresh, false, "a forced refresh within 30 seconds is the same read")
  assert.equal(stripe.count("/payment_intents"), 1)
})

test("live: a section Stripe refuses stays empty with the permission it asked for; the rest still shows", async () => {
  const { stripe, medusa } = liveStore()
  const refusing = new FakeStripe({
    ...stripe.routes,
    "/payouts": () => {
      throw new StripeApiError({ kind: "permission", status: 403, message: "The provided key 'rk_live_***' does not have the required permissions. Having the 'rak_payout_read' permission would allow this request to continue." })
    },
  })
  const overview = await loadStripeOverview(container({ apiKey: READ_KEY }, medusa, refusing))
  assert.equal(overview.paymentsTotal, 5)
  assert.deepEqual(overview.errors.map((e) => [e.section, e.permission]), [["payouts", "rak_payout_read"]])
  assert.deepEqual(overview.payouts, { upcoming: [], past: [] })
})

test("the payments page: filters, methods and search from the cached read, no extra call to Stripe", async () => {
  const { stripe, medusa, payments } = liveStore()
  const c = container({ apiKey: READ_KEY }, medusa, stripe)
  const { snapshot } = await loadSnapshot(c, {})
  const all = paymentsPage(snapshot, { filter: "all", method: "all", q: "", offset: 0, limit: 2 })
  assert.equal(all.count, 5)
  assert.equal(all.payments.length, 2)
  /* "Need a look" is the paid cart without an order only: a declined card is in "Declined", never a task. */
  assert.deepEqual(all.counts, { all: 5, succeeded: 4, failed: 1, attention: 1, refunded: 0, disputed: 1, outside: 1, foreign: 0 })
  assert.equal(paymentsPage(snapshot, { filter: "all", method: "blik", q: "", offset: 0, limit: 20 }).count, 2)
  assert.equal(paymentsPage(snapshot, { filter: "all", method: "all", q: "#1002", offset: 0, limit: 20 }).payments[0]?.id, payments.apple.id)
  assert.equal(paymentsPage(snapshot, { filter: "all", method: "all", q: String(payments.link.id).toUpperCase(), offset: 0, limit: 20 }).count, 1)
  assert.equal(paymentsPage(snapshot, { filter: "outside", method: "all", q: "", offset: 0, limit: 20 }).payments[0]?.id, payments.link.id)
  assert.equal(stripe.count("/payment_intents"), 1)
})

test("the checks: Stripe and Medusa read once, the webhook judged against this admin's address", async () => {
  const { stripe, medusa } = liveStore()
  const c = container({ apiKey: READ_KEY }, medusa, stripe)
  const checks = await runStripeChecks(c, { origin: "https://api.kodasupply.example" })
  const v = Object.fromEntries(checks.results.map((r) => [r.key, r.verdict]))
  assert.deepEqual(v, { provider: "pass", key: "pass", account: "pass", capabilities: "pass", webhook: "pass", deliveries: "pass", domains: "pass", regions: "pass", capture: "pass", orphans: "fail" })
  assert.equal(checks.webhookUrl, "https://api.kodasupply.example/hooks/payment/stripe_stripe")
  const orphans = checks.results.find((r) => r.key === "orphans")!
  assert.equal(orphans.items[0].value, "cart_FixtureLost")
  assert.equal(checks.summary.fail, 1)
  /* The events read asks for failed deliveries of PaymentIntents in the last day. */
  const events = stripe.calls.find((x) => x.path === "/events")?.params as Record<string, unknown>
  assert.equal(events.delivery_success, false)
  assert.equal(events.type, "payment_intent.*")
  /* Opened on another address, the same endpoint looks like someone else's. */
  const elsewhere = await runStripeChecks(container({ apiKey: READ_KEY }, medusa, liveStore().stripe), { origin: "https://admin.other.example" })
  assert.equal(elsewhere.results.find((r) => r.key === "webhook")?.code, "otherHost")
  /* backendUrl wins over the address of the admin. */
  const pinned = await runStripeChecks(container({ apiKey: READ_KEY, backendUrl: "https://api.kodasupply.example" }, medusa, liveStore().stripe), { origin: "https://admin.other.example" })
  assert.equal(pinned.results.find((r) => r.key === "webhook")?.verdict, "pass")
})

test("a check turned off skips its read", async () => {
  const { stripe, medusa } = liveStore()
  const checks = await runStripeChecks(container({ apiKey: READ_KEY, checks: { domains: false, deliveries: false } }, medusa, stripe), { origin: null })
  assert.equal(stripe.count("/payment_method_domains"), 0)
  assert.equal(stripe.count("/events"), 0)
  assert.equal(checks.results.find((r) => r.key === "domains")?.verdict, "off")
})

test("the order widget: the PaymentIntent behind the order's payment, with fee, net, refunds and the dispute", async () => {
  const charge = { id: "ch_FixtureW", amount: 15_000, amount_captured: 15_000, amount_refunded: 5_000, currency: "pln", status: "succeeded", captured: true, disputed: true, outcome: { type: "authorized", risk_level: "elevated", risk_score: 71, seller_message: "Payment complete." }, payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", wallet: { type: "google_pay" } } }, balance_transaction: bt(15_000, 325, "pln", { available_on: 1_800_000_000 }), refunds: { data: [{ id: "re_FixtureW", amount: 5_000, currency: "pln", created: 1_790_000_000, status: "succeeded", reason: "requested_by_customer" }] } }
  const paymentIntent = { id: "pi_FixtureWidget", amount: 15_000, amount_received: 15_000, currency: "pln", created: 1_789_000_000, status: "succeeded", capture_method: "automatic", livemode: true, metadata: { session_id: "payses_w" }, latest_charge: charge }
  const stripe = new FakeStripe({
    "/payment_intents/*": () => paymentIntent,
    "/disputes": (params) => (params?.payment_intent === "pi_FixtureWidget" ? [dispute(paymentIntent, { dueInHours: 100 })] : []),
  })
  const order = {
    id: "order_FixtureW",
    display_id: 1042,
    payment_collections: [{ payments: [{ provider_id: "pp_stripe_stripe", data: { id: "pi_FixtureWidget", client_secret: "pi_FixtureWidget_secret_DoNotLeak" } }], payment_sessions: [{ provider_id: "pp_stripe_stripe", data: { id: "pi_FixtureWidget" } }, { provider_id: "pp_system_default", data: {} }] }],
  }
  const c = container({ apiKey: READ_KEY }, { orders: [order] }, stripe)
  const res = await loadStripeOrder(c, "order_FixtureW")
  assert.equal(res.none, false)
  assert.equal(res.payments.length, 1)
  const p = res.payments[0]
  assert.equal(p.found, true)
  assert.equal(p.payment?.method, "google_pay")
  assert.deepEqual(p.payment?.fee, { amount: 325, currency: "pln" })
  assert.deepEqual(p.payment?.net, { amount: 14_675, currency: "pln" })
  assert.equal(p.payment?.risk, "elevated")
  assert.equal(p.outcome?.riskScore, 71)
  assert.deepEqual(p.payment?.order, { id: "order_FixtureW", displayId: 1042 })
  assert.equal(p.refunds.length, 1)
  assert.equal(p.disputes.length, 1)
  assert.equal(p.disputes[0].urgency, "soon")
  assert.equal(p.feeDetails[0].type, "stripe_fee")
  assert.ok(!JSON.stringify(res).includes("secret"), "the client secret never leaves the server")
  const call = stripe.calls.find((x) => x.path === "/payment_intents/pi_FixtureWidget")
  assert.deepEqual((call?.params as { expand: string[] }).expand, ["latest_charge.balance_transaction", "latest_charge.refunds"])
  /* Cached per PaymentIntent. */
  await loadStripeOrder(c, "order_FixtureW")
  assert.equal(stripe.count("/payment_intents/pi_FixtureWidget"), 1)
})

test("the order widget says why a payment cannot be read, and when an order was not paid with Stripe", async () => {
  const stripe = new FakeStripe({
    "/payment_intents/*": () => {
      throw new StripeApiError({ kind: "not_found", status: 404, message: "No such payment_intent: 'pi_FixtureOther'" })
    },
  })
  const orders = [
    { id: "order_FixtureX", display_id: 7, payment_collections: [{ payments: [{ provider_id: "pp_stripe-przelewy24_stripe", data: { id: "pi_FixtureOther" } }] }] },
    { id: "order_FixtureCod", display_id: 8, payment_collections: [{ payments: [{ provider_id: "pp_system_default", data: {} }] }] },
  ]
  const c = container({ apiKey: READ_KEY }, { orders }, stripe)
  const x = await loadStripeOrder(c, "order_FixtureX")
  assert.equal(x.payments[0].problem, "not_found")
  assert.equal(x.payments[0].providerId, "pp_stripe-przelewy24_stripe")
  assert.equal((await loadStripeOrder(c, "order_FixtureCod")).none, true)
  assert.equal((await loadStripeOrder(c, "order_FixtureMissing")).none, true)
  const unconfigured = await loadStripeOrder(container({}, { orders }, stripe), "order_FixtureX")
  assert.equal(unconfigured.payments[0].problem, "unconfigured")
})

test("demo mode never calls Stripe and still fills every part of the page", async () => {
  /* A demo store seeded without a checkout: no payment collections, so "stripe-or-none" pays them. */
  const orders = Array.from({ length: 30 }, (_, i) => ({ id: `order_FixtureD${i}`, display_id: 2000 + i, created_at: ago(i * 20).toISOString(), total: `${150 + i}.00`, currency_code: "pln" }))
  const c = container({ demo: true, demoOrders: "stripe-or-none" }, { orders, regions: REGIONS.map(({ payment_providers: _p, ...r }) => r) as MedusaData["regions"], storeCors: "https://kodasupply.example" }, new RefusingStripe())
  const overview = await loadStripeOverview(c, { origin: "https://api.kodasupply.example" })
  assert.equal(overview.mode, "demo")
  assert.ok(overview.paymentsTotal >= 30)
  assert.ok(overview.payments.every((p) => p.demo))
  assert.ok(overview.disputes.length >= 1)
  assert.ok(overview.refunds.length >= 1)
  assert.ok((overview.balance?.pending.length ?? 0) > 0)
  const checks = await runStripeChecks(c, { origin: "https://api.kodasupply.example" })
  assert.equal(checks.mode, "demo")
  assert.equal(checks.results.find((r) => r.key === "webhook")?.verdict, "pass")
  assert.equal(checks.results.find((r) => r.key === "orphans")?.verdict, "fail")
  const order = await loadStripeOrder(c, "order_FixtureD3")
  assert.equal(order.mode, "demo")
  assert.equal(order.payments[0].found, true)
  assert.deepEqual(order.payments[0].payment?.order, { id: "order_FixtureD3", displayId: 2003 })
})

test("without a key: an empty panel, the setup in the status, the Medusa side still checked, no request to Stripe", async () => {
  const c = container({}, { providers: PROVIDERS, regions: REGIONS })
  const overview = await loadStripeOverview(c)
  assert.equal(overview.mode, "unconfigured")
  assert.equal(overview.fetchedAt, null)
  const status = buildStatus(c, "https://api.kodasupply.example")
  assert.equal(status.mode, "unconfigured")
  assert.deepEqual(status.missing, ["apiKey"])
  assert.equal(status.webhookUrl, "https://api.kodasupply.example/hooks/payment/stripe_stripe")
  const checks = await runStripeChecks(c, { origin: "https://api.kodasupply.example" })
  const v = Object.fromEntries(checks.results.map((r) => [r.key, r.verdict]))
  assert.equal(v.key, "fail")
  assert.equal(v.provider, "pass")
  assert.equal(v.regions, "warn")
  assert.equal(v.account, "unknown")
  assert.equal(checks.results.find((r) => r.key === "account")?.hint, "auth")
})

test("the status shows the key's kind, mode and last four characters, never the key", () => {
  const c = container({ apiKey: READ_KEY, providerId: "stripe-test", references: [{ name: "Koda Supply", url: "https://kodasupply.example" }] }, { storeCors: "https://kodasupply.example" })
  const status = buildStatus(c, null)
  assert.ok(!JSON.stringify(status).includes(READ_KEY))
  assert.deepEqual(status.key, { kind: "restricted", mode: "live", last4: READ_KEY.slice(-4) })
  assert.deepEqual(status.options.providerIds, { card: "pp_stripe_stripe-test", blik: "pp_stripe-blik_stripe-test", p24: "pp_stripe-przelewy24_stripe-test" })
  assert.deepEqual(status.options.storefrontDomains, ["kodasupply.example"])
  assert.equal(status.options.storefrontSource, "store_cors")
  assert.equal(status.webhookUrl, null)
  assert.equal(status.webhookPath, "/hooks/payment/stripe_stripe-test")
  assert.equal(status.references.length, 1)
})

test("this backend's address from the proxy headers, refusing anything that is not a host", () => {
  assert.equal(requestOrigin({ headers: { "x-forwarded-host": "API.KodaSupply.example", "x-forwarded-proto": "https" } }), "https://api.kodasupply.example")
  assert.equal(requestOrigin({ headers: { host: "localhost:9000" }, protocol: "http" }), "http://localhost:9000")
  assert.equal(requestOrigin({ headers: { host: "evil.example/../x" } }), null)
  assert.equal(requestOrigin({ headers: {} }), null)
})

/* ------------------------------------------------------------------ */
/* Demo: only orders Stripe would have paid                            */
/* ------------------------------------------------------------------ */

function demoStore() {
  const at = (h: number) => ago(h).toISOString()
  const collection = (provider: string, kind: "payments" | "payment_sessions" = "payments") => [{ [kind]: [{ provider_id: provider }] }]
  return [
    { id: "order_FixtureCard", display_id: 3001, created_at: at(2), total: "189.00", currency_code: "pln", payment_collections: collection("pp_stripe_stripe") },
    { id: "order_FixtureBlik", display_id: 3002, created_at: at(4), total: "59.00", currency_code: "pln", payment_collections: collection("pp_stripe-blik_stripe", "payment_sessions") },
    /* An Allegro import marked paid, cash on delivery, an unpaid import (a collection, no payment) and another gateway. */
    { id: "order_FixtureAllegro", display_id: 3003, created_at: at(6), total: "99.00", currency_code: "pln", metadata: { allegro_order_id: "x" }, payment_collections: collection("pp_system_default") },
    { id: "order_FixtureCod", display_id: 3004, created_at: at(8), total: "79.00", currency_code: "pln", payment_collections: collection("pp_cod_cod", "payment_sessions") },
    { id: "order_FixtureUnpaidImport", display_id: 3005, created_at: at(9), total: "79.00", currency_code: "pln", payment_collections: [{ payments: [], payment_sessions: [] }] },
    { id: "order_FixturePayU", display_id: 3006, created_at: at(10), total: "79.00", currency_code: "pln", payment_collections: collection("pp_payu_payu") },
    /* Seeded without a checkout: no collection at all. A shopper's metadata never makes an order a Stripe one. */
    { id: "order_FixtureSeed", display_id: 3007, created_at: at(12), total: "129.00", currency_code: "pln", metadata: { stripe: true, payment_provider: "pp_stripe_stripe" } },
    /* No total, and under Stripe's minimum charge. */
    { id: "order_FixtureNoTotal", display_id: 3008, created_at: at(13), total: null, currency_code: "pln", payment_collections: collection("pp_stripe_stripe") },
    { id: "order_FixtureTiny", display_id: 3009, created_at: at(14), total: "1.00", currency_code: "pln", payment_collections: collection("pp_stripe_stripe") },
  ]
}

test("demo pays only orders Stripe would have paid: never imports, cash on delivery or another gateway", async () => {
  const orders = demoStore()
  const c = container({ demo: true }, { orders, regions: REGIONS }, new RefusingStripe())
  const { snapshot } = await loadSnapshot(c, {})
  const paid = new Set(snapshot.payments.map((p) => p.order?.id).filter(Boolean))
  assert.deepEqual([...paid].sort(), ["order_FixtureBlik", "order_FixtureCard"])
  /* BLIK follows the order's own provider. */
  assert.equal(snapshot.payments.find((p) => p.order?.id === "order_FixtureBlik")?.method, "blik")
  for (const id of ["order_FixtureAllegro", "order_FixtureCod", "order_FixtureUnpaidImport", "order_FixturePayU", "order_FixtureSeed", "order_FixtureNoTotal", "order_FixtureTiny"]) {
    assert.equal((await loadStripeOrder(c, id)).none, true, id)
  }
  assert.equal((await loadStripeOrder(c, "order_FixtureCard")).none, false)
  /* The queries ask for providers, never for metadata. */
  assert.ok(c.queries.every((q) => !q.fields.some((f) => f.includes("metadata"))), JSON.stringify(c.queries.map((q) => q.fields)))
  /* "stripe-or-none" adds the order without any payment collection, nothing else. */
  const seeded = container({ demo: true, demoOrders: "stripe-or-none" }, { orders, regions: REGIONS }, new RefusingStripe())
  const more = new Set((await loadSnapshot(seeded, {})).snapshot.payments.map((p) => p.order?.id).filter(Boolean))
  assert.deepEqual([...more].sort(), ["order_FixtureBlik", "order_FixtureCard", "order_FixtureSeed"])
})

test("demo totals: one query for every order; one at a time only when Medusa refuses it", async () => {
  const orders = demoStore()
  let refusedOnce = false
  const c = container({ demo: true }, { orders, regions: REGIONS }, new RefusingStripe())
  const base = c.resolve<{ graph: (a: Record<string, unknown>) => Promise<{ data: unknown[] }> }>("query")
  const graph = base.graph
  base.graph = async (args) => {
    const fields = (args.fields as string[]) ?? []
    const ids = (args.filters as { id?: unknown } | undefined)?.id
    if (fields.includes("total") && Array.isArray(ids) && ids.length > 1) {
      refusedOnce = true
      throw new Error("shipping method without a version")
    }
    return graph(args)
  }
  const { snapshot } = await loadSnapshot(c, {})
  assert.ok(refusedOnce)
  assert.equal(new Set(snapshot.payments.map((p) => p.order?.id).filter(Boolean)).size, 2)
  const totals = c.queries.filter((q) => q.fields.includes("total"))
  assert.ok(totals.length >= 3, "the batch, then one per order")
})

test("demo: an order older than the panel's 30 days shows its payment dated at the order, with the panel's refunds and dispute", async () => {
  const old = Array.from({ length: 12 }, (_, i) => ({
    id: `order_FixtureOld${i}`,
    display_id: 4000 + i,
    created_at: ago(24 * (60 + i)).toISOString(),
    total: `${200 + i}.00`,
    currency_code: "pln",
    payment_collections: [{ payments: [{ provider_id: "pp_stripe_stripe" }] }],
  }))
  const c = container({ demo: true }, { orders: old, regions: REGIONS }, new RefusingStripe())
  const { snapshot } = await loadSnapshot(c, {})
  const moved = snapshot.payments.find((p) => p.order?.id === "order_FixtureOld0")
  assert.ok(moved, "the panel still shows the payment within its 30 days")
  const res = await loadStripeOrder(c, "order_FixtureOld0")
  const p = res.payments[0].payment!
  const orderAt = Date.parse(String(old[0].created_at))
  assert.ok(Date.parse(p.created) <= orderAt && Date.parse(p.created) > orderAt - 10 * 60_000, "paid a few minutes before the order")
  assert.equal(p.id, moved?.id)
  /* Refunds and disputes the panel gave the payment stay with it. */
  const refunded = snapshot.payments.find((x) => x.refunded && x.order)
  if (refunded?.order) {
    const r = await loadStripeOrder(c, refunded.order.id)
    assert.deepEqual(r.payments[0].payment?.refunded, refunded.refunded)
  }
})

/* ------------------------------------------------------------------ */
/* The order widget: freshness, stale answers, errors                  */
/* ------------------------------------------------------------------ */

function widgetStore() {
  const paymentIntent = pi({ amount: 15_000, method: { type: "blik" }, fee: 300, sessionId: "payses_w2" })
  const stripe = new FakeStripe({ "/payment_intents/*": () => paymentIntent })
  const order = {
    id: "order_FixtureW2",
    display_id: 1043,
    payment_collections: [{ payments: [{ provider_id: "pp_stripe-blik_stripe", data: { id: paymentIntent.id }, captured_at: null, canceled_at: null, refunds: [] }] }],
  }
  return { paymentIntent, stripe, order }
}

test("the widget reads Stripe again after a capture or a refund in Medusa, and on Refresh once 30 seconds passed", async () => {
  const { stripe, order } = widgetStore()
  const c = container({ apiKey: READ_KEY }, { orders: [order] }, stripe)
  await loadStripeOrder(c, order.id)
  await loadStripeOrder(c, order.id)
  assert.equal(stripe.count("/payment_intents/*"), 1)
  /* Medusa captured the payment: a new read, without waiting for the cache. */
  order.payment_collections[0].payments[0].captured_at = new Date().toISOString() as never
  await loadStripeOrder(c, order.id)
  assert.equal(stripe.count("/payment_intents/*"), 2)
  /* A refund in Medusa: again. */
  order.payment_collections[0].payments[0].refunds = [{ id: "ref_1" }] as never
  await loadStripeOrder(c, order.id)
  assert.equal(stripe.count("/payment_intents/*"), 3)
  /* Refresh right after a read is served from the cache; 30 seconds later it reads again. */
  let now = Date.now()
  setCacheForTests(c.svc, new TtlCache({ now: () => now }))
  await loadStripeOrder(c, order.id)
  assert.equal(stripe.count("/payment_intents/*"), 4)
  now += 10_000
  await loadStripeOrder(c, order.id, { force: true })
  assert.equal(stripe.count("/payment_intents/*"), 4)
  now += 25_000
  await loadStripeOrder(c, order.id, { force: true })
  assert.equal(stripe.count("/payment_intents/*"), 5)
})

test("when Stripe stops answering, the widget shows the last good read, marked stale", async () => {
  const { stripe, order, paymentIntent } = widgetStore()
  let down = false
  const flaky = new FakeStripe({
    "/payment_intents/*": () => {
      if (down) throw new StripeApiError({ kind: "network", message: "No connection to Stripe" })
      return paymentIntent
    },
  })
  void stripe
  let now = Date.now()
  const c = container({ apiKey: READ_KEY, cacheSeconds: 30 }, { orders: [order] }, flaky)
  setCacheForTests(c.svc, new TtlCache({ now: () => now }))
  const first = await loadOrderPayments(c, order.id, { origin: null, now: () => new Date(now) })
  assert.equal(first.payments[0].stale, false)
  assert.ok(first.payments[0].readAt)
  down = true
  now += 60_000
  const later = await loadOrderPayments(c, order.id, { origin: null, now: () => new Date(now) })
  assert.equal(later.payments[0].found, true)
  assert.equal(later.payments[0].stale, true)
  assert.equal(later.payments[0].readAt, first.payments[0].readAt)
})

test("the widget keeps no client secret or personal data in memory, and counts dispute days at every answer", async () => {
  const paymentIntent = pi({ amount: 15_000, method: { type: "card" }, fee: 300, sessionId: "payses_w3", disputed: true }) as Record<string, unknown>
  paymentIntent.client_secret = "pi_FixtureW3_secret_DoNotKeep"
  ;(paymentIntent.latest_charge as Record<string, unknown>).billing_details = { name: "Jan Kowalski", email: "jan@example.com" }
  const stripe = new FakeStripe({
    "/payment_intents/*": () => paymentIntent,
    "/disputes": () => [dispute(paymentIntent as never, { dueInHours: 50, evidence: { customer_name: "Jan Kowalski" } } as never)],
  })
  const order = { id: "order_FixtureW3", display_id: 1044, payment_collections: [{ payments: [{ provider_id: "pp_stripe_stripe", data: { id: paymentIntent.id } }] }] }
  const c = container({ apiKey: READ_KEY, cacheSeconds: 86_400 }, { orders: [order] }, stripe)
  const start = NOW.getTime()
  const a = await loadOrderPayments(c, order.id, { origin: null, now: () => new Date(start) })
  assert.equal(a.payments[0].disputes[0].daysLeft, 3)
  /* The same cached read, two days later: the deadline moved closer. */
  const b = await loadOrderPayments(c, order.id, { origin: null, now: () => new Date(start + 2 * 86_400_000) })
  assert.equal(stripe.count("/payment_intents/*"), 1)
  assert.equal(b.payments[0].disputes[0].daysLeft, 1)
  assert.equal(b.payments[0].disputes[0].urgency, "urgent")
  const memory = JSON.stringify([...(cacheFor(c.svc) as unknown as { spaces: Map<string, Map<string, unknown>> }).spaces.values()].map((m) => [...m.values()]))
  assert.ok(!memory.includes("DoNotKeep") && !memory.includes("Kowalski") && !memory.includes("jan@example.com"), "normalized before it is kept")
})

test("routes: a Stripe error is a 502 with its masked message, anything else a 500 with a plain sentence", async () => {
  const { respond } = await import("../src/api/admin/stripe/helpers.ts")
  const { fakeResponse } = await import("./kit-conformance.ts")
  const c = container({ apiKey: READ_KEY })
  const req = { scope: c, method: "GET", path: "/admin/stripe/overview" } as never
  const stripeRes = fakeResponse()
  await respond(req, stripeRes, async () => {
    throw new StripeApiError({ kind: "stripe", status: 500, message: `Stripe broke for ${READ_KEY}`, secrets: [READ_KEY] })
  })
  assert.equal(stripeRes.statusCode, 502)
  assert.ok(!JSON.stringify(stripeRes.body).includes(READ_KEY))
  const dbRes = fakeResponse()
  await respond(req, dbRes, async () => {
    throw new Error('relation "payment_session" does not exist at line 4')
  })
  assert.equal(dbRes.statusCode, 500)
  assert.ok(!JSON.stringify(dbRes.body).includes("relation"), "no SQL to the browser")
})

test("the order route refuses an id that is not one, before any read", async () => {
  const { GET } = await import("../src/api/admin/stripe/orders/[id]/route.ts")
  const { fakeResponse } = await import("./kit-conformance.ts")
  const stripe = new RefusingStripe()
  const c = container({ apiKey: READ_KEY }, {}, stripe)
  const res = fakeResponse()
  await GET({ scope: c, params: { id: "../../etc" }, query: {}, headers: {} } as never, res)
  assert.equal(res.statusCode, 400)
  assert.equal(stripe.calls, 0)
})
