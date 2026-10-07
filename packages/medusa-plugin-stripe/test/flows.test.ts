/**
 * The reads end to end: the real flows (snapshot, overview, payments page,
 * checks, order widget, status) against a fake Medusa container (Query, the
 * payment module, the config) and a scripted Stripe client. No network:
 * `fetch` is replaced for the whole file and refuses every call.
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import KodaStripeModuleService from "../src/modules/stripe/service.ts"
import { STRIPE_MODULE } from "../src/modules/stripe/lib/constants.ts"
import { StripeApiError } from "../src/modules/stripe/lib/errors.ts"
import type { StripePluginOptions } from "../src/modules/stripe/lib/options.ts"
import type { StripeParams } from "../src/modules/stripe/lib/client.ts"
import { buildStatus } from "../src/api/admin/stripe/helpers.ts"
import { loadStripeOrder, loadStripeOverview, runStripeChecks } from "../src/workflows/stripe/reads.ts"
import { paymentsPage } from "../src/workflows/stripe/overview.ts"
import { CLIENT_KEY, requestOrigin } from "../src/workflows/stripe/runtime.ts"
import { loadSnapshot } from "../src/workflows/stripe/snapshot.ts"
import { READ_KEY, account, bt, dispute, domain, endpoint, methodConfig, pi, refund } from "./fixtures.ts"

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network in tests")
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})

const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} }
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000)

/* ------------------------------------------------------------------ */
/* A scripted Stripe and a fake Medusa                                 */
/* ------------------------------------------------------------------ */

type Handler = (params: StripeParams | undefined) => unknown

class FakeStripe {
  calls: Array<{ path: string; params?: StripeParams }> = []
  readonly routes: Record<string, Handler>
  constructor(routes: Record<string, Handler>) {
    this.routes = routes
  }
  private answer(path: string, params?: StripeParams): unknown {
    this.calls.push({ path, params })
    const exact = this.routes[path]
    const prefix = Object.entries(this.routes).find(([k]) => k.endsWith("/*") && path.startsWith(k.slice(0, -1)))?.[1]
    const handler = exact ?? prefix
    if (!handler) throw new StripeApiError({ kind: "not_found", message: `No such route ${path}`, status: 404 })
    return handler(params)
  }
  async get<T>(path: string, params?: StripeParams): Promise<T> {
    return this.answer(path, params) as T
  }
  async list<T>(path: string, params: StripeParams): Promise<{ data: T[]; complete: boolean; pages: number }> {
    return { data: this.answer(path, params) as T[], complete: true, pages: 1 }
  }
  count(path: string): number {
    return this.calls.filter((c) => c.path === path).length
  }
}

class RefusingStripe {
  async get(): Promise<never> {
    throw new Error("demo mode must not call Stripe")
  }
  async list(): Promise<never> {
    throw new Error("demo mode must not call Stripe")
  }
}

interface MedusaData {
  sessions?: Record<string, { orderId?: string; displayId?: number; cartId?: string }>
  sessionModes?: Array<{ livemode: boolean }>
  regions?: Array<{ id: string; name: string; currency_code: string; payment_providers: Array<{ id: string; is_enabled: boolean }> }>
  orders?: Array<Record<string, unknown>>
  providers?: Array<{ id: string; is_enabled: boolean }>
  storeCors?: string
}

function graph(m: MedusaData) {
  return async (args: Record<string, unknown>) => {
    const filters = (args.filters ?? {}) as Record<string, unknown>
    if (args.entity === "payment_session" && Array.isArray(filters.id)) {
      return {
        data: (filters.id as string[])
          .filter((id) => m.sessions?.[id])
          .map((id) => {
            const s = m.sessions![id]
            return { id, payment_collection: { id: `pay_col_${id}`, order: s.orderId ? { id: s.orderId, display_id: s.displayId ?? null } : null, cart: s.cartId ? { id: s.cartId } : null } }
          }),
      }
    }
    if (args.entity === "payment_session") return { data: (m.sessionModes ?? []).map((s, i) => ({ id: `payses_mode${i}`, data: { id: `pi_mode${i}`, livemode: s.livemode, client_secret: "pi_mode_secret_x" } })) }
    if (args.entity === "region") return { data: m.regions ?? [] }
    if (args.entity === "order") {
      const id = filters.id
      return { data: id ? (m.orders ?? []).filter((o) => o.id === id) : (m.orders ?? []) }
    }
    return { data: [] }
  }
}

function container(options: StripePluginOptions, medusa: MedusaData = {}, client?: unknown) {
  const svc = new KodaStripeModuleService({ logger: silent as never }, options)
  const registry: Record<string, unknown> = {
    [STRIPE_MODULE]: svc,
    [ContainerRegistrationKeys.QUERY]: { graph: graph(medusa) },
    [Modules.PAYMENT]: { listPaymentProviders: async () => medusa.providers ?? [] },
    [ContainerRegistrationKeys.CONFIG_MODULE]: { projectConfig: { http: { storeCors: medusa.storeCors ?? "" } } },
    [CLIENT_KEY]: client,
  }
  return {
    svc,
    resolve<T>(key: string, o?: { allowUnregistered?: boolean }): T {
      if (registry[key] !== undefined) return registry[key] as T
      if (o?.allowUnregistered) return undefined as T
      throw new Error(`not registered: ${key}`)
    },
  }
}

const PROVIDERS = ["pp_system_default", "pp_stripe_stripe", "pp_stripe-blik_stripe", "pp_stripe-przelewy24_stripe"].map((id) => ({ id, is_enabled: true }))
const REGIONS = [{ id: "reg_FixturePL", name: "Polska", currency_code: "pln", payment_providers: [{ id: "pp_stripe_stripe", is_enabled: true }] }]

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
  assert.deepEqual(all.counts, { all: 5, succeeded: 4, failed: 1, attention: 2, refunded: 0, disputed: 1, outside: 1 })
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
  const orders = Array.from({ length: 30 }, (_, i) => ({ id: `order_FixtureD${i}`, display_id: 2000 + i, created_at: ago(i * 20).toISOString(), total: `${150 + i}.00`, currency_code: "pln" }))
  const c = container({ demo: true }, { orders, regions: REGIONS.map(({ payment_providers: _p, ...r }) => r) as MedusaData["regions"], storeCors: "https://kodasupply.example" }, new RefusingStripe())
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
