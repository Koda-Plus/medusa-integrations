/**
 * Stripe in the koda.integration/1 contract: the shared conformance checks
 * on a sample store (orders and customers), then what Stripe itself
 * promises: the worst payment of an order speaks, a declined attempt before
 * the payment is history, the payment fact carries the method, Stripe's fee
 * and the net formatted with the currency's exponent, metadata changes
 * nothing, a summary of many orders reads only a few payments from Stripe,
 * a failed read serves the last good one as stale, the counters link to
 * filters the page has, and the demo never calls Stripe.
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { stripeIntegration } from "../src/workflows/stripe/integration.ts"
import { makeContext } from "../src/modules/stripe/lib/kit-routes.ts"
import { StripeApiError } from "../src/modules/stripe/lib/errors.ts"
import { TtlCache } from "../src/modules/stripe/lib/cache.ts"
import { setCacheForTests } from "../src/workflows/stripe/runtime.ts"
import middlewares from "../src/api/middlewares.ts"
import { conformance, fakeResponse } from "./kit-conformance.ts"
import { FakeStripe, PROVIDERS, REGIONS, RefusingStripe, container, paidOrder, type MedusaData } from "./harness.ts"
import { READ_KEY, account, dispute, domain, endpoint, hoursAgo, methodConfig, pi, refund } from "./fixtures.ts"

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network in tests")
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})

const A = "order_01STRIPEINTEGRATION0001"
const B = "order_01STRIPEINTEGRATION0002"
const C = "order_01STRIPEINTEGRATION0003"
const D = "order_01STRIPEINTEGRATION0004"
const E = "order_01STRIPEINTEGRATION0005"

type Pi = ReturnType<typeof pi>

/** Stripe answers per PaymentIntent id, the panel's lists, and the checks' reads. */
function stripeFor(intents: Pi[], extra: { disputes?: ReturnType<typeof dispute>[]; refunds?: ReturnType<typeof refund>[] } = {}) {
  const byId = new Map(intents.map((p) => [String(p.id), p]))
  const disputes = extra.disputes ?? []
  return new FakeStripe({
    "/payment_intents": () => intents,
    "/payment_intents/*": (_params, path) => {
      const found = byId.get(path.split("/").pop() ?? "")
      if (!found) throw new StripeApiError({ kind: "not_found", status: 404, message: "No such payment_intent" })
      return found
    },
    "/disputes": (params) => (params?.payment_intent ? disputes.filter((d) => (d.payment_intent as { id?: string })?.id === params.payment_intent) : disputes),
    "/refunds": () => extra.refunds ?? [],
    "/balance": () => ({ available: [{ amount: 12_000, currency: "pln" }], pending: [] }),
    "/payouts": () => [],
    "/account": () => account(),
    "/payment_method_configurations": () => [methodConfig()],
    "/webhook_endpoints": () => [endpoint()],
    "/events": () => [],
    "/payment_method_domains": () => [domain("kodasupply.example"), domain("www.kodasupply.example")],
  })
}

/** A Polish store: A paid by card, B a BLIK payment with a dispute to answer, C a Przelewy24 refund that failed, D only metadata, E an Allegro import. */
function sample() {
  const card = pi({ amount: 15_000, method: { type: "card", brand: "visa", last4: "4242" }, fee: 239, sessionId: "payses_IntA" })
  const blik = pi({ amount: 24_900, method: { type: "blik" }, fee: 498, sessionId: "payses_IntB", disputed: true })
  const p24 = pi({ amount: 9_900, method: { type: "p24", bank: "mbank_mtransfer" }, fee: 258, sessionId: "payses_IntC" })
  ;(p24.latest_charge as Record<string, unknown>).refunds = { data: [{ id: "re_FixtureFailed", amount: 9_900, currency: "pln", created: Math.floor(Date.now() / 1000) - 3600, status: "failed" }] }
  const orphan = pi({ amount: 5_000, method: { type: "blik" }, fee: 180, sessionId: "payses_IntLost", created: hoursAgo(3) })
  const disputes = [dispute(blik, { dueInHours: 24 * 9 })]
  const refunds = [refund(p24, 9_900, { status: "failed", failure_reason: "expired_or_canceled_card", created: Math.floor(Date.now() / 1000) - 3600 })]
  const stripe = stripeFor([card, blik, p24, orphan], { disputes, refunds })
  const medusa: MedusaData = {
    orders: [
      paidOrder(A, 1001, "pp_stripe_stripe", String(card.id), { customer_id: "cus_IntA" }),
      paidOrder(B, 1002, "pp_stripe-blik_stripe", String(blik.id), { customer_id: "cus_IntA" }),
      paidOrder(C, 1003, "pp_stripe-przelewy24_stripe", String(p24.id), { customer_id: "cus_IntB" }),
      /* A shopper's metadata names a PaymentIntent: it must change nothing. */
      { id: D, display_id: 1004, customer_id: "cus_IntB", created_at: new Date().toISOString(), metadata: { stripe_payment_intent: card.id, payment_provider: "pp_stripe_stripe" } },
      paidOrder(E, 1005, "pp_system_default", null, { metadata: { allegro_order_id: "A-1" } }),
    ],
    sessions: {
      payses_IntA: { orderId: A, displayId: 1001 },
      payses_IntB: { orderId: B, displayId: 1002 },
      payses_IntC: { orderId: C, displayId: 1003 },
      payses_IntLost: { cartId: "cart_IntLost" },
    },
    regions: REGIONS,
    providers: PROVIDERS,
    storeCors: "https://kodasupply.example,https://www.kodasupply.example",
    sessionModes: [{ livemode: true }],
  }
  const calls: string[] = []
  const c = container({ apiKey: READ_KEY }, medusa, stripe, {
    event_bus: {
      emit: async () => {
        calls.push("event_bus.emit")
      },
    },
  })
  return { c, stripe, medusa, calls, intents: { card, blik, p24, orphan } }
}

{
  const s = sample()
  conformance({ routes: stripeIntegration, scope: s.c, entity: "order", knownIds: [A, B, C, D, E], writes: () => s.calls })
}
{
  const s = sample()
  conformance({ routes: stripeIntegration, scope: s.c, entity: "customer", knownIds: ["cus_IntA", "cus_IntB"], writes: () => s.calls })
}

const pl = (scope: unknown) => makeContext({ scope: scope as never, lang: "pl" })
const en = (scope: unknown) => makeContext({ scope: scope as never, lang: "en" })

test("the worst payment of an order speaks: a dispute to answer waits for a person, a failed refund went wrong", async () => {
  const s = sample()
  const [a, b, c] = await stripeIntegration.build.summaries(pl(s.c), "order", [A, B, C])
  assert.equal(a.state, "ok")
  assert.equal(a.title.key, "integration.order.paid")
  assert.equal(a.title.fallback, "Opłacone, Visa 4242")
  assert.equal(b.state, "attention")
  assert.equal(b.title.key, "integration.order.disputeAnswer")
  assert.equal(b.counts.disputes, 1)
  assert.equal(c.state, "failed")
  assert.equal(c.title.key, "integration.order.refundFailed")
  /* links[0] opens the plugin page searched for the order, the second one the payment in the Dashboard. */
  assert.deepEqual(a.links[0], { kind: "admin", href: "/stripe?q=1001" })
  assert.match(a.links[1]?.href ?? "", /^https:\/\/dashboard\.stripe\.com\/payments\/pi_/)
  assert.equal(a.widget, "stripe.order")
})

test("the payment fact: the method, Stripe's fee and the net, money moved by the currency's exponent", async () => {
  const s = sample()
  const [a] = await stripeIntegration.build.summaries(pl(s.c), "order", [A])
  const fact = a.facts.find((f) => f.slot === "payment")!
  assert.equal(fact.priority, 80)
  assert.equal(fact.value.fallback, "Visa 4242")
  assert.equal(fact.sub?.key, "integration.fact.feeNet")
  assert.match(String(fact.sub?.params?.fee), /^2,39\s?zł$/)
  assert.match(String(fact.sub?.params?.net), /^147,61\s?zł$/)
  assert.equal(fact.link?.kind, "external")
  /* Zero-decimal currencies stay whole: 5 000 JPY is not 50,00. */
  const yen = pi({ amount: 5_000, currency: "jpy", method: { type: "card" }, fee: 180 })
  const j = container({ apiKey: READ_KEY }, { orders: [paidOrder("order_FixtureYen", 7, "pp_stripe_stripe", String(yen.id), { currency_code: "jpy" })] }, stripeFor([yen]))
  const [y] = await stripeIntegration.build.summaries(en(j), "order", ["order_FixtureYen"])
  const sub = String(y.facts[0].sub?.params?.fee)
  assert.match(sub, /180/)
  assert.ok(!sub.includes("1.80"), sub)
})

test("a declined attempt before the payment is history; metadata and imports change nothing", async () => {
  const declined = pi({ amount: 15_000, status: "requires_payment_method", error: { code: "card_declined" }, sessionId: "payses_IntF1" })
  const paid = pi({ amount: 15_000, method: { type: "blik" }, fee: 300, sessionId: "payses_IntF2" })
  const order = {
    id: "order_FixtureRetry",
    display_id: 1010,
    payment_collections: [
      {
        payments: [{ provider_id: "pp_stripe-blik_stripe", data: { id: paid.id }, captured_at: new Date().toISOString(), refunds: [] }],
        payment_sessions: [{ provider_id: "pp_stripe_stripe", data: { id: declined.id } }],
      },
    ],
  }
  const c = container({ apiKey: READ_KEY }, { orders: [order] }, stripeFor([declined, paid]))
  const [r] = await stripeIntegration.build.summaries(en(c), "order", ["order_FixtureRetry"])
  assert.equal(r.state, "ok")
  assert.equal(r.counts.payments, 2)
  assert.equal(r.facts[0].value.fallback, "BLIK")

  const s = sample()
  const [d, e] = await stripeIntegration.build.summaries(en(s.c), "order", [D, E])
  assert.equal(d.state, "none")
  assert.equal(e.state, "none")
  assert.equal(s.stripe.calls.length, 0, "nothing to read for orders Stripe never paid")
})

test("an authorization Stripe canceled while Medusa still holds it went wrong; a payment Medusa canceled is nothing to do", async () => {
  const expired = pi({ amount: 15_000, status: "canceled", method: { type: "card" }, sessionId: "payses_Expired" })
  const voided = pi({ amount: 15_000, status: "canceled", method: { type: "card" }, sessionId: "payses_Voided" })
  const payment = (id: string, canceledAt: string | null) => [{ payments: [{ provider_id: "pp_stripe_stripe", data: { id }, captured_at: null, canceled_at: canceledAt, refunds: [] }] }]
  const orders = [
    { id: "order_FixtureExpired", display_id: 1201, payment_collections: payment(String(expired.id), null) },
    { id: "order_FixtureVoided", display_id: 1202, payment_collections: payment(String(voided.id), new Date().toISOString()) },
  ]
  const c = container({ apiKey: READ_KEY }, { orders }, stripeFor([expired, voided]))
  const [x, v] = await stripeIntegration.build.summaries(en(c), "order", ["order_FixtureExpired", "order_FixtureVoided"])
  assert.equal(x.state, "failed")
  assert.equal(x.title.key, "integration.order.canceledStripe")
  assert.equal(v.state, "none")
})

test("a summary of many orders reads at most five payments from Stripe; the rest come from Medusa's own record", async () => {
  const intents = Array.from({ length: 8 }, (_, i) => pi({ amount: 10_000 + i, method: { type: "card" }, fee: 200, sessionId: `payses_Many${i}` }))
  const orders = intents.map((p, i) => paidOrder(`order_FixtureMany${i}`, 2000 + i, "pp_stripe_stripe", String(p.id)))
  const stripe = stripeFor(intents)
  const c = container({ apiKey: READ_KEY }, { orders }, stripe)
  const items = await stripeIntegration.build.summaries(en(c), "order", orders.map((o) => String(o.id)))
  assert.equal(stripe.count("/payment_intents/*"), 5)
  assert.ok(items.every((x) => x.state === "ok"))
  const fromMedusa = items.filter((x) => x.detail?.key === "integration.order.medusaOnly")
  assert.equal(fromMedusa.length, 3)
  /* A second look reads the next ones; the first five come from the cache. */
  await stripeIntegration.build.summaries(en(c), "order", orders.map((o) => String(o.id)))
  assert.equal(stripe.count("/payment_intents/*"), 8)
})

test("when Stripe does not answer, the last good read is served as stale; with nothing read, it says so", async () => {
  const card = pi({ amount: 15_000, method: { type: "card" }, fee: 239, sessionId: "payses_Stale" })
  let down = false
  const stripe = new FakeStripe({
    "/payment_intents/*": () => {
      if (down) throw new StripeApiError({ kind: "network", message: "No connection to Stripe" })
      return card
    },
  })
  let now = Date.now()
  const c = container({ apiKey: READ_KEY, cacheSeconds: 30 }, { orders: [paidOrder("order_FixtureStale", 3001, "pp_stripe_stripe", String(card.id))] }, stripe)
  setCacheForTests(c.svc, new TtlCache({ now: () => now }))
  const [first] = await stripeIntegration.build.summaries(en(c), "order", ["order_FixtureStale"])
  assert.equal(first.stale, false)
  down = true
  now += 120_000
  const [later] = await stripeIntegration.build.summaries(en(c), "order", ["order_FixtureStale"])
  assert.equal(later.stale, true)
  assert.equal(later.state, "ok", "the last good read, not unavailable")
  assert.equal(later.detail?.key, "integration.order.stale")
  assert.equal(later.updatedAt, first.updatedAt)

  const never = container({ apiKey: READ_KEY }, { orders: [paidOrder("order_FixtureNever", 3002, "pp_stripe_stripe", "pi_FixtureNever")] }, new FakeStripe({}))
  const [n] = await stripeIntegration.build.summaries(en(never), "order", ["order_FixtureNever"])
  assert.equal(n.state, "unavailable")
})

test("a customer: the worst order speaks, from the panel's read and the widget's cache, never a read per payment", async () => {
  const s = sample()
  const [a, b] = await stripeIntegration.build.summaries(pl(s.c), "customer", ["cus_IntA", "cus_IntB"])
  assert.equal(a.state, "attention")
  assert.equal(a.title.key, "integration.customer.order")
  assert.match(a.title.fallback, /^Zamówienie #1002: Spór: odpowiedz do /)
  assert.equal(b.state, "failed")
  assert.equal(s.stripe.count("/payment_intents/*"), 0)
  /* A calm customer: how many payments and the method used most. */
  const calm = container({ apiKey: READ_KEY }, { ...s.medusa, orders: s.medusa.orders!.filter((o) => o.id === A) }, s.stripe)
  const [c] = await stripeIntegration.build.summaries(en(calm), "customer", ["cus_IntA"])
  assert.equal(c.state, "ok")
  assert.equal(c.title.fallback, "1 Stripe payment")
  assert.equal(c.detail?.fallback, "Mostly Card")
})

test("board counters: what needs a look, open disputes and failing checks, each linked to a filter the page has", async () => {
  const s = sample()
  const a = await stripeIntegration.build.attention(en(s.c), ["orders", "integration"])
  const by = Object.fromEntries(a.items.map((c) => [c.key, c]))
  /* The paid cart without an order and the failed refund. */
  assert.equal(by.payments_failed.count, 2)
  assert.equal(by.payments_failed.tone, "red")
  assert.equal(by.payments_failed.link.href, "/stripe?filter=attention")
  assert.deepEqual(by.payments_failed.ids, [C])
  assert.equal(by.disputes_open.count, 1)
  assert.equal(by.disputes_open.link.href, "/stripe?filter=disputed")
  assert.equal(by.health_failing.scope, "integration")
  assert.equal(by.health_failing.tone, "orange")
  assert.ok(by.health_failing.count >= 1, "the paid cart without an order fails its check")
  assert.equal(by.health_failing.link.href, "/stripe?filter=checks")
  /* The counters reuse the panel's read: a second board view asks Stripe nothing. */
  const before = s.stripe.calls.length
  await stripeIntegration.build.attention(en(s.c), ["orders", "integration"])
  assert.equal(s.stripe.calls.length, before)
})

test("without a key: not set up, Medusa's record in the lines, no counters, no request to Stripe", async () => {
  const s = sample()
  const stripe = new RefusingStripe()
  const c = container({}, s.medusa, stripe)
  const m = await stripeIntegration.build.manifest(en(c))
  assert.equal(m.mode, "off")
  assert.equal(m.configured, false)
  assert.equal(m.problems[0]?.key, "integration.problem.not_configured")
  const [a] = await stripeIntegration.build.summaries(en(c), "order", [A])
  assert.equal(a.state, "off")
  assert.equal(a.facts[0]?.value.fallback, "Stripe")
  assert.deepEqual((await stripeIntegration.build.attention(en(c), ["orders", "integration"])).items, [])
  assert.equal(stripe.calls, 0)
})

test("demo: sample lines for orders Stripe would have paid, none for imports, no Dashboard links, never a request to Stripe", async () => {
  const stripe = new RefusingStripe()
  const orders = [
    { id: "order_FixtureDemoCard", display_id: 5001, customer_id: "cus_Demo", created_at: new Date(Date.now() - 3_600_000).toISOString(), total: "150.00", currency_code: "pln", payment_collections: [{ payments: [{ provider_id: "pp_stripe_stripe" }] }] },
    { id: "order_FixtureDemoAllegro", display_id: 5002, customer_id: "cus_Demo", created_at: new Date(Date.now() - 7_200_000).toISOString(), total: "90.00", currency_code: "pln", payment_collections: [{ payments: [{ provider_id: "pp_system_default" }] }] },
  ]
  const c = container({ demo: true }, { orders, regions: REGIONS }, stripe)
  const m = await stripeIntegration.build.manifest(en(c))
  assert.equal(m.mode, "demo")
  const [card, allegro] = await stripeIntegration.build.summaries(en(c), "order", ["order_FixtureDemoCard", "order_FixtureDemoAllegro"])
  assert.equal(card.state, "ok")
  assert.equal(card.detail?.key, "integration.order.demo")
  assert.ok(card.links.every((l) => l.kind === "admin"))
  assert.equal(card.facts[0].link?.kind, "admin")
  assert.equal(allegro.state, "none")
  const [cust] = await stripeIntegration.build.summaries(en(c), "customer", ["cus_Demo"])
  assert.equal(cust.detail?.key, "integration.customer.demo")
  const counters = await stripeIntegration.build.attention(en(c), ["orders"])
  assert.ok(counters.items.some((x) => x.key === "disputes_open"))
  assert.equal(stripe.calls, 0)
})

test("the write guard stands in front of every admin route of the plugin", async () => {
  const route = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: Array<(req: unknown, res: unknown, next: () => void) => void> }> }).routes.find((r) => r.matcher === "/admin/stripe*")
  assert.ok(route)
  const guard = route.middlewares[0]
  const form = fakeResponse()
  let passed = false
  guard({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }, form, () => (passed = true))
  assert.equal(form.statusCode, 415)
  assert.equal(passed, false)
  guard({ method: "GET", headers: {} }, fakeResponse(), () => (passed = true))
  assert.equal(passed, true)
})
