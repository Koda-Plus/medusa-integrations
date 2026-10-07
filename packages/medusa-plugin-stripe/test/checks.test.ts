import { test } from "node:test"
import assert from "node:assert/strict"
import {
  captureModeOf,
  checkAccount,
  checkCapabilities,
  checkCapture,
  checkDeliveries,
  checkDomains,
  checkKey,
  checkOrphans,
  checkProvider,
  checkRegions,
  defaultMethodConfig,
  elementOffers,
  normalizeDomain,
  providerIds,
  runChecks,
  summarize,
  type ChecksInput,
} from "../src/modules/stripe/lib/checks.ts"
import { CHECK_KEYS } from "../src/modules/stripe/lib/constants.ts"
import { DashboardLinks } from "../src/modules/stripe/lib/dashboard.ts"
import { normalizePaymentIntent, type PaymentFacts } from "../src/modules/stripe/lib/normalize.ts"
import type { CheckKey } from "../src/modules/stripe/lib/contract.ts"
import { NOW, account, daysAgo, domain, endpoint, event, hoursAgo, methodConfig, pi } from "./fixtures.ts"

const dashboard = new DashboardLinks("live")
const IDS = providerIds("stripe")

/** Payment facts as the snapshot builds them; sessions in `foreign` are unknown to this Medusa. */
function facts(list: ReturnType<typeof pi>[], orders: Record<string, string> = {}, foreign: string[] = []): PaymentFacts[] {
  const ctx = {
    dashboard,
    orders: { orderOf: (s: string | null | undefined) => (s && orders[s] ? { id: orders[s], displayId: 1 } : null), known: (s: string) => !foreign.includes(s) },
    demo: false,
  }
  return list.map((p) => normalizePaymentIntent(p, ctx)!.facts)
}

/** A healthy Polish store: every check passes. Each test breaks one thing. */
function healthy(over: Partial<ChecksInput> = {}): ChecksInput {
  return {
    now: NOW,
    demo: false,
    enabled: Object.fromEntries(CHECK_KEYS.map((k) => [k, true])) as Record<CheckKey, boolean>,
    providerId: "stripe",
    key: { kind: "restricted", mode: "live", last4: "1234" },
    keyFailure: null,
    account: account(),
    methodConfigs: [methodConfig()],
    endpoints: [endpoint()],
    failedEvents: [],
    domains: [domain("kodasupply.example"), domain("www.kodasupply.example")],
    storefront: { domains: ["kodasupply.example", "www.kodasupply.example"], source: "store_cors" },
    backendHosts: ["api.kodasupply.example"],
    expectedWebhookUrl: "https://api.kodasupply.example/hooks/payment/stripe_stripe",
    providers: ["pp_system_default", IDS.card, IDS.blik, IDS.p24].map((id) => ({ id, isEnabled: true })),
    regions: [{ id: "reg_FixturePL", name: "Polska", currency: "pln", providers: [IDS.card] }],
    payments: facts([pi({ amount: 10_000, sessionId: "payses_a", created: hoursAgo(5) })], { payses_a: "order_FixtureA" }),
    ordersFailure: null,
    orderOf: () => null,
    balanceCurrencies: ["pln"],
    sessionModes: { live: 12, test: 0 },
    dashboard,
    ...over,
  }
}

test("a healthy Polish store passes every check", () => {
  const results = runChecks(healthy())
  assert.deepEqual(
    results.map((r) => [r.key, r.verdict]),
    CHECK_KEYS.map((k) => [k, "pass"]),
  )
  assert.deepEqual(summarize(results), { pass: 10, warn: 0, fail: 0, info: 0, off: 0, unknown: 0, worst: "pass" })
  assert.equal(results.find((r) => r.key === "regions")?.code, "viaElement")
})

test("a check turned off in the options says so and reads nothing", () => {
  const enabled = { ...healthy().enabled, domains: false }
  const results = runChecks(healthy({ enabled, domains: null }))
  const d = results.find((r) => r.key === "domains")
  assert.equal(d?.verdict, "off")
  assert.equal(summarize(results).off, 1)
})

test("provider: registered, disabled, under another id, missing", () => {
  assert.equal(checkProvider(healthy()).code, "registered")
  const disabled = checkProvider(healthy({ providers: [{ id: IDS.card, isEnabled: false }] }))
  assert.equal(disabled.verdict, "warn")
  assert.equal(disabled.code, "disabled")
  const other = checkProvider(healthy({ providers: [{ id: "pp_stripe_stripe-test", isEnabled: true }, { id: "pp_stripe-blik_stripe-test", isEnabled: true }] }))
  assert.equal(other.verdict, "warn")
  assert.equal(other.code, "otherId")
  assert.equal(other.params.suggestion, "stripe-test")
  assert.equal(other.hint, "setProviderId")
  const missing = checkProvider(healthy({ providers: [{ id: "pp_system_default", isEnabled: true }] }))
  assert.equal(missing.verdict, "fail")
  assert.equal(missing.params.expected, "pp_stripe_stripe")
  assert.equal(checkProvider(healthy({ providers: { error: "x", status: null, kind: "unknown", permission: null } })).verdict, "unknown")
})

test("key: missing, publishable, refused, mode mismatch, test, secret, restricted", () => {
  assert.equal(checkKey(healthy({ key: { kind: null, mode: null, last4: null } })).code, "missing")
  assert.equal(checkKey(healthy({ key: { kind: "publishable", mode: "live", last4: "abcd" } })).verdict, "fail")
  assert.equal(checkKey(healthy({ keyFailure: { error: "Invalid API Key provided", status: 401, kind: "auth", permission: null } })).code, "invalid")
  const mismatch = checkKey(healthy({ key: { kind: "restricted", mode: "test", last4: "1234" }, sessionModes: { live: 8, test: 0 } }))
  assert.equal(mismatch.verdict, "fail")
  assert.equal(mismatch.code, "modeMismatch")
  assert.deepEqual([mismatch.params.key, mismatch.params.store], ["test", "live"])
  /* A store with both a live and a test instance of the provider is not a mismatch. */
  assert.equal(checkKey(healthy({ key: { kind: "restricted", mode: "test", last4: "1234" }, sessionModes: { live: 8, test: 2 } })).code, "test")
  assert.equal(checkKey(healthy({ key: { kind: "restricted", mode: "test", last4: "1234" } , sessionModes: { live: 0, test: 3 } })).verdict, "info")
  assert.equal(checkKey(healthy({ key: { kind: "secret", mode: "live", last4: "1234" } })).verdict, "warn")
  assert.equal(checkKey(healthy({ key: { kind: "unknown", mode: null, last4: "1234" } })).code, "unknownFormat")
  assert.equal(checkKey(healthy()).code, "restricted")
})

test("account: ready, charges off, payouts off, requirements due, currency, country", () => {
  assert.equal(checkAccount(healthy()).code, "ready")
  const charges = checkAccount(healthy({ account: account({ charges_enabled: false, requirements: { disabled_reason: "requirements.past_due", currently_due: ["external_account"] } }) }))
  assert.equal(charges.verdict, "fail")
  assert.equal(charges.params.reason, "requirements.past_due")
  assert.equal(checkAccount(healthy({ account: account({ payouts_enabled: false }) })).code, "payoutsDisabled")
  const due = checkAccount(healthy({ account: account({ requirements: { currently_due: ["company.tax_id", "representative.dob"], past_due: [], current_deadline: Math.floor(daysAgo(-5).getTime() / 1000) } }) }))
  assert.equal(due.verdict, "warn")
  assert.equal(due.params.count, 2)
  const eur = checkAccount(healthy({ account: account({ default_currency: "eur" }), balanceCurrencies: ["eur"] }))
  assert.equal(eur.verdict, "warn")
  assert.equal(eur.code, "currency")
  /* A PLN balance means PLN settles in PLN: no conversion to warn about. */
  assert.equal(checkAccount(healthy({ account: account({ default_currency: "eur" }), balanceCurrencies: ["eur", "pln"] })).verdict, "pass")
  assert.equal(checkAccount(healthy({ account: account({ country: "DE", default_currency: "pln" }) })).verdict, "info")
  const refused = checkAccount(healthy({ account: { error: "denied", status: 403, kind: "permission", permission: "rak_accounts_kyc_basic_read" } }))
  assert.equal(refused.verdict, "unknown")
  assert.equal(refused.permission, "rak_accounts_kyc_basic_read")
})

test("capabilities: active, card off, BLIK off, in review, hidden at checkout, not reported", () => {
  assert.equal(checkCapabilities(healthy()).code, "active")
  assert.equal(checkCapabilities(healthy({ account: account({ capabilities: { card_payments: "inactive", blik_payments: "active", p24_payments: "active" } }) })).verdict, "fail")
  const blik = checkCapabilities(healthy({ account: account({ capabilities: { card_payments: "active", blik_payments: "inactive", p24_payments: "active" } }) }))
  assert.equal(blik.code, "inactive")
  assert.equal(blik.params.methods, "blik")
  const review = checkCapabilities(healthy({ account: account({ capabilities: { card_payments: "active", blik_payments: "active", p24_payments: "pending" } }) }))
  assert.equal(review.code, "pending")
  assert.equal(review.params.methods, "p24")
  const hidden = checkCapabilities(healthy({ methodConfigs: [methodConfig({ apple_pay: "off", blik: "off" })] }))
  assert.equal(hidden.verdict, "warn")
  assert.equal(hidden.code, "hidden")
  assert.equal(hidden.params.methods, "blik,apple_pay")
  assert.equal(checkCapabilities(healthy({ account: account({ capabilities: {} }), methodConfigs: null })).code, "notReported")
  /* A configuration of a Connect application is not the account's own. */
  assert.equal(defaultMethodConfig([{ ...methodConfig(), id: "pmc_app", application: "ca_x" }, { ...methodConfig(), id: "pmc_own", is_default: true }])?.id, "pmc_own")
})

test("deliveries: none, a few retrying, a lost payment_intent.succeeded; the grace and the window", () => {
  assert.equal(checkDeliveries(healthy()).code, "none")
  const some = checkDeliveries(healthy({ failedEvents: [event("payment_intent.payment_failed", hoursAgo(2)), event("payment_intent.processing", hoursAgo(20))] }))
  assert.equal(some.verdict, "warn")
  assert.equal(some.params.count, 2)
  const lost = checkDeliveries(healthy({ failedEvents: [event("payment_intent.succeeded", hoursAgo(1)), event("payment_intent.payment_failed", hoursAgo(3))] }))
  assert.equal(lost.verdict, "fail")
  assert.equal(lost.params.succeeded, 1)
  /* Stripe does not say which endpoint failed: with another listener on the account it may be that service's. */
  const shared = checkDeliveries(
    healthy({
      endpoints: [endpoint(), endpoint({ url: "https://erp.example/stripe", enabled_events: ["payment_intent.succeeded"] })],
      failedEvents: [event("payment_intent.succeeded", hoursAgo(1))],
    }),
  )
  assert.equal(shared.verdict, "warn")
  assert.equal(shared.code, "succeededShared")
  /* Without the endpoints there is nothing to blame this Medusa with. */
  assert.equal(checkDeliveries(healthy({ endpoints: null, failedEvents: [event("payment_intent.succeeded", hoursAgo(1))] })).verdict, "warn")
  /* Events of the last minutes may simply not have been sent yet; events older than a day are out of the window. */
  const quiet = checkDeliveries(healthy({ failedEvents: [event("payment_intent.succeeded", new Date(NOW.getTime() - 60_000)), event("payment_intent.succeeded", hoursAgo(30))] }))
  assert.equal(quiet.verdict, "pass")
})

test("domains: registered and active, missing www, disabled, Apple Pay inactive, storefront unknown, none", () => {
  assert.equal(checkDomains(healthy()).code, "ok")
  const missing = checkDomains(healthy({ domains: [domain("kodasupply.example")] }))
  assert.equal(missing.verdict, "warn")
  assert.equal(missing.params.domains, "www.kodasupply.example")
  assert.equal(checkDomains(healthy({ domains: [domain("kodasupply.example"), domain("WWW.KodaSupply.example", { enabled: false })] })).code, "disabled")
  const inactive = checkDomains(healthy({ domains: [domain("kodasupply.example"), domain("www.kodasupply.example", { apple_pay: { status: "inactive", status_details: { error_message: "The domain could not be verified." } } })] }))
  assert.equal(inactive.code, "inactive")
  assert.equal(inactive.params.error, "The domain could not be verified.")
  const unknown = checkDomains(healthy({ storefront: { domains: [], source: "none" } }))
  assert.equal(unknown.verdict, "info")
  assert.equal(checkDomains(healthy({ storefront: { domains: [], source: "none" }, domains: [] })).code, "none")
  assert.equal(normalizeDomain("https://Shop.Example:443/checkout"), "shop.example")
  assert.equal(normalizeDomain("localhost"), null)
})

test("regions: the Payment Element, separate providers, missing methods, no Stripe, no PLN", () => {
  assert.equal(checkRegions(healthy()).code, "viaElement")
  assert.equal(checkRegions(healthy({ regions: [{ id: "reg_FixturePL", name: "Polska", currency: "pln", providers: [IDS.card, IDS.blik, IDS.p24] }], payments: [] })).code, "ok")
  const missing = checkRegions(healthy({ payments: [] }))
  assert.equal(missing.verdict, "warn")
  assert.equal(missing.code, "missingMethods")
  assert.equal(missing.params.methods, "blik,p24")
  assert.equal(missing.link?.url, "/settings/regions/reg_FixturePL")
  const none = checkRegions(healthy({ regions: [{ id: "reg_FixturePL", name: "Polska", currency: "pln", providers: ["pp_system_default"] }] }))
  assert.equal(none.verdict, "fail")
  assert.equal(none.params.regions, "Polska")
  assert.equal(checkRegions(healthy({ regions: [{ id: "reg_FixtureEU", name: "Europa", currency: "eur", providers: [IDS.card] }] })).verdict, "info")
  assert.deepEqual(elementOffers(healthy().payments as PaymentFacts[]), { blik: true, p24: true })
})

test("capture: automatic passes, manual with the Payment Element warns, manual cards with separate providers pass", () => {
  assert.equal(checkCapture(healthy()).code, "automatic")
  const manual = facts([pi({ amount: 1000, capture: "manual", types: ["card", "link"], sessionId: "payses_m" })])
  assert.equal(captureModeOf(manual), "manual")
  const warned = checkCapture(healthy({ payments: manual }))
  assert.equal(warned.verdict, "warn")
  assert.equal(warned.code, "manual")
  assert.equal(warned.hint, "captureTrue")
  const separate = checkCapture(healthy({ payments: manual, regions: [{ id: "reg_FixturePL", name: "Polska", currency: "pln", providers: [IDS.card, IDS.blik, IDS.p24] }] }))
  assert.equal(separate.code, "manualCards")
  assert.equal(checkCapture(healthy({ payments: [] })).verdict, "info")
  assert.equal(captureModeOf([]), "unknown")
})

test("orphans: a payment that succeeded without an order fails, within the window and after the grace", () => {
  assert.equal(checkOrphans(healthy()).verdict, "pass")
  const orphan = pi({ amount: 18_900, sessionId: "payses_lost", created: hoursAgo(3) })
  const found = checkOrphans(healthy({ payments: facts([orphan]) }))
  assert.equal(found.verdict, "fail")
  assert.equal(found.params.count, 1)
  assert.deepEqual(found.items[0].money, { amount: 18_900, currency: "pln" })
  assert.equal(found.items[0].url, `https://dashboard.stripe.com/payments/${orphan.id}`)
  /* Too fresh (the webhook may still be on its way), too old, failed, or not from Medusa: not orphans. */
  const fine = facts([
    pi({ amount: 1, sessionId: "payses_new", created: new Date(NOW.getTime() - 10 * 60_000) }),
    pi({ amount: 1, sessionId: "payses_old", created: daysAgo(9) }),
    pi({ amount: 1, sessionId: "payses_failed", status: "requires_payment_method", error: {}, created: hoursAgo(3) }),
    pi({ amount: 1, sessionId: null, created: hoursAgo(3) }),
  ])
  assert.equal(checkOrphans(healthy({ payments: fine })).verdict, "pass")
  /* When Medusa could not match payments to orders, nothing is called an orphan. */
  assert.equal(checkOrphans(healthy({ payments: facts([orphan]), ordersFailure: { error: "db down", status: null, kind: "unknown", permission: null } })).verdict, "unknown")
  /* The advice is to look, never to refund. */
  assert.equal(found.hint, "check")
})

test("orphans: another Medusa on the same Stripe account is information, a replaced session is nothing", () => {
  const other = pi({ amount: 4_900, sessionId: "payses_staging", created: hoursAgo(3) })
  const replaced = pi({ amount: 4_900, sessionId: "payses_switched", status: "canceled", created: hoursAgo(3) })
  const list = facts([other, replaced], {}, ["payses_staging", "payses_switched"])
  assert.equal(list[0].session, "foreign")
  assert.equal(list[1].session, "replaced")
  const r = checkOrphans(healthy({ payments: list }))
  assert.equal(r.verdict, "info")
  assert.equal(r.code, "foreign")
  assert.equal(r.params.count, 1)
  assert.equal(r.items[0].tone, "grey")
  /* A known orphan next to it still fails, and only the known one is counted. */
  const mixed = checkOrphans(healthy({ payments: [...list, ...facts([pi({ amount: 1_000, sessionId: "payses_ours", created: hoursAgo(2) })])] }))
  assert.equal(mixed.verdict, "fail")
  assert.equal(mixed.params.count, 1)
})

test("a store that does not sell in PLN gets no Polish warnings: settlement, BLIK, Przelewy24, capture", () => {
  const eur = healthy({
    regions: [{ id: "reg_FixtureDE", name: "Deutschland", currency: "eur", providers: [IDS.card] }],
    payments: facts([pi({ amount: 10_000, currency: "eur", sessionId: "payses_de", created: hoursAgo(5) })], { payses_de: "order_FixtureDE" }),
    account: account({ country: "DE", default_currency: "eur", capabilities: { card_payments: "active", blik_payments: "inactive", p24_payments: "inactive" } }),
    balanceCurrencies: ["eur"],
  })
  assert.equal(checkAccount(eur).verdict, "pass")
  const caps = checkCapabilities(eur)
  assert.equal(caps.verdict, "pass")
  assert.equal(caps.code, "activeNoPln")
  assert.equal(checkCapture(eur).code, "notApplicable")
  assert.equal(checkRegions(eur).code, "noPln")
  /* The same account in a store with a PLN region still warns. */
  const pln = healthy({ account: account({ default_currency: "eur", capabilities: { card_payments: "active", blik_payments: "inactive", p24_payments: "active" } }), balanceCurrencies: ["eur"] })
  assert.equal(checkAccount(pln).code, "currency")
  assert.equal(checkCapabilities(pln).code, "inactive")
  /* Without the regions, PLN payments decide; without either, the checks judge as before. */
  assert.equal(checkCapabilities(healthy({ regions: null, payments: null, account: account({ capabilities: { card_payments: "active", blik_payments: "inactive", p24_payments: "active" } }) })).code, "inactive")
})

test("an error inside a check reaches the admin masked", () => {
  const broken = healthy({ secrets: ["rk_live_FAKEsecretValue1234"] })
  Object.defineProperty(broken, "domains", {
    get() {
      throw new Error("boom with rk_live_FAKEsecretValue1234 inside")
    },
  })
  const r = runChecks(broken).find((x) => x.key === "domains")!
  assert.equal(r.verdict, "unknown")
  assert.ok(r.error && !r.error.includes("FAKEsecretValue1234"), r.error ?? "")
})

test("summaries: the worst verdict wins", () => {
  assert.equal(summarize([{ verdict: "pass" }, { verdict: "warn" }, { verdict: "info" }]).worst, "warn")
  assert.equal(summarize([{ verdict: "pass" }, { verdict: "fail" }, { verdict: "warn" }]).worst, "fail")
  assert.equal(summarize([{ verdict: "off" }]).worst, "off")
  assert.equal(summarize([]).worst, "unknown")
})
