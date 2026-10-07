import { test } from "node:test"
import assert from "node:assert/strict"
import { DashboardLinks } from "../src/modules/stripe/lib/dashboard.ts"
import { checkWebhook, expectedWebhookUrl, matchEndpoints, parseUrl, pathMatch, requiredEvents, type WebhookCheckInput } from "../src/modules/stripe/lib/webhooks.ts"
import { ALL_EVENTS, HOOK, endpoint } from "./fixtures.ts"

const base = (over: Partial<WebhookCheckInput> = {}): WebhookCheckInput => ({
  endpoints: [endpoint()],
  backendHosts: ["api.kodasupply.example"],
  expectedUrl: HOOK,
  providerId: "stripe",
  captureMode: "automatic",
  dashboard: new DashboardLinks("live"),
  demo: false,
  ...over,
})

test("URLs are compared by host and path: case, default ports, trailing slashes and queries do not matter", () => {
  assert.deepEqual(parseUrl("HTTPS://API.KodaSupply.example:443/hooks/payment/stripe_stripe/?x=1"), { origin: "https://api.kodasupply.example", host: "api.kodasupply.example", path: "/hooks/payment/stripe_stripe" })
  assert.equal(parseUrl("http://localhost:9000/hooks")?.host, "localhost:9000")
  assert.equal(parseUrl("ftp://x.example/hooks"), null)
  assert.equal(parseUrl("not a url"), null)
  assert.equal(expectedWebhookUrl("https://api.kodasupply.example/", "stripe"), "https://api.kodasupply.example/hooks/payment/stripe_stripe")
  assert.equal(expectedWebhookUrl("https://kodasupply.example/api", "stripe-test"), "https://kodasupply.example/api/hooks/payment/stripe_stripe-test")
  assert.equal(expectedWebhookUrl(null, "stripe"), null)
})

test("paths: the provider's hook, the BLIK and Przelewy24 variants of the same entry, nothing else", () => {
  assert.equal(pathMatch("/hooks/payment/stripe_stripe", "stripe"), "exact")
  assert.equal(pathMatch("/api/hooks/payment/stripe_stripe", "stripe"), "exact")
  assert.equal(pathMatch("/hooks/payment/stripe-blik_stripe", "stripe"), "variant")
  assert.equal(pathMatch("/hooks/payment/stripe-przelewy24_stripe", "stripe"), "variant")
  assert.equal(pathMatch("/hooks/payment/stripe_stripe-test", "stripe"), null)
  assert.equal(pathMatch("/hooks/payment/stripe_stripe-test", "stripe-test"), "exact")
  assert.equal(pathMatch("/hooks/payment/paypal_paypal", "stripe"), null)
  const m = matchEndpoints([endpoint(), endpoint({ url: "https://staging.kodasupply.example/hooks/payment/stripe_stripe" }), endpoint({ url: "https://x.example/other" })], { backendHosts: ["api.kodasupply.example"], providerId: "stripe" })
  assert.deepEqual(
    m.map((x) => [x.host, x.hostMatch]),
    [
      ["api.kodasupply.example", true],
      ["staging.kodasupply.example", false],
    ],
  )
})

test("an enabled endpoint at this backend with the events Medusa needs passes; Medusa's other events are listed as optional", () => {
  const r = checkWebhook(base({ endpoints: [endpoint({ enabled_events: ["payment_intent.succeeded"] })] }))
  assert.equal(r.verdict, "pass")
  assert.equal(r.code, "ok")
  assert.deepEqual(
    r.items.filter((i) => i.state === "optional").map((i) => i.label),
    ["payment_intent.payment_failed", "payment_intent.partially_funded", "payment_intent.amount_capturable_updated"],
  )
  assert.equal(checkWebhook(base({ endpoints: [endpoint({ enabled_events: ["*"] })] })).verdict, "pass")
  assert.equal(checkWebhook(base()).items.filter((i) => i.state === "optional").length, 0)
})

test("amount_capturable_updated is required while cards are captured by hand", () => {
  assert.deepEqual(requiredEvents("automatic"), ["payment_intent.succeeded"])
  assert.deepEqual(requiredEvents("unknown"), ["payment_intent.succeeded", "payment_intent.amount_capturable_updated"])
  const r = checkWebhook(base({ captureMode: "manual", endpoints: [endpoint({ enabled_events: ["payment_intent.succeeded"] })] }))
  assert.equal(r.verdict, "fail")
  assert.equal(r.code, "missingEvents")
  assert.equal(r.params.events, "payment_intent.amount_capturable_updated")
})

test("no endpoint: fail with the URL and the events to add", () => {
  const r = checkWebhook(base({ endpoints: [] }))
  assert.equal(r.verdict, "fail")
  assert.equal(r.code, "missing")
  assert.equal(r.params.expected, HOOK)
  assert.equal(r.hint, "add")
  assert.equal(r.link?.url, "https://dashboard.stripe.com/webhooks")
})

test("an endpoint on another host warns; a disabled one fails; missing succeeded fails", () => {
  const other = checkWebhook(base({ endpoints: [endpoint({ url: "https://staging.kodasupply.example/hooks/payment/stripe_stripe" })] }))
  assert.equal(other.verdict, "warn")
  assert.equal(other.code, "otherHost")
  const disabled = checkWebhook(base({ endpoints: [endpoint({ status: "disabled" })] }))
  assert.equal(disabled.verdict, "fail")
  assert.equal(disabled.code, "disabled")
  const missing = checkWebhook(base({ endpoints: [endpoint({ enabled_events: ["payment_intent.payment_failed"] })] }))
  assert.equal(missing.code, "missingEvents")
  assert.equal(missing.params.events, "payment_intent.succeeded")
})

test("two endpoints at this backend warn: one webhookSecret cannot verify both", () => {
  const r = checkWebhook(base({ endpoints: [endpoint(), endpoint({ url: "https://api.kodasupply.example/hooks/payment/stripe-blik_stripe", enabled_events: [...ALL_EVENTS] })] }))
  assert.equal(r.verdict, "warn")
  assert.equal(r.code, "duplicates")
  assert.equal(r.params.count, 2)
})

test("without a known backend address, the path alone decides", () => {
  const r = checkWebhook(base({ backendHosts: [], expectedUrl: null }))
  assert.equal(r.verdict, "pass")
  assert.equal(r.code, "okPathOnly")
})

test("a refused read is unknown, with the permission Stripe named", () => {
  const r = checkWebhook(base({ endpoints: { error: "no permission", status: 403, kind: "permission", permission: "rak_webhook_read" } }))
  assert.equal(r.verdict, "unknown")
  assert.equal(r.permission, "rak_webhook_read")
  assert.equal(r.hint, "permission")
  assert.equal(checkWebhook(base({ endpoints: null })).verdict, "unknown")
})
