import { test } from "node:test"
import assert from "node:assert/strict"
import { baseUrl, bool, domainList, domainsFromCors, missingOptions, resolveOptions } from "../src/modules/stripe/lib/options.ts"
import { keyInfo, maskSecrets, permissionFrom, safeStripeId } from "../src/modules/stripe/lib/security.ts"
import { READ_KEY } from "./fixtures.ts"

test("defaults: no demo, provider id stripe, five minutes of cache, every check on, nothing missing but the key", () => {
  const o = resolveOptions(undefined)
  assert.equal(o.apiKey, "")
  assert.equal(o.demo, false)
  assert.equal(o.providerId, "stripe")
  assert.equal(o.backendUrl, null)
  assert.equal(o.storefrontDomains, null)
  assert.equal(o.cacheSeconds, 300)
  assert.equal(o.maxPages, 20)
  assert.equal(o.requestsPerSecond, 10)
  assert.equal(o.timeoutMs, 20_000)
  assert.ok(Object.values(o.checks).every(Boolean))
  assert.equal(Object.keys(o.checks).length, 10)
  assert.equal("references" in o, false)
  assert.deepEqual(missingOptions(o), ["apiKey"])
  assert.deepEqual(missingOptions(resolveOptions({ demo: true })), [])
  assert.deepEqual(missingOptions(resolveOptions({ apiKey: ` ${READ_KEY} ` })), [])
  assert.equal(resolveOptions({ apiKey: ` ${READ_KEY} ` }).apiKey, READ_KEY)
})

test("values from environment variables: strings for numbers and booleans, broken ones fall back", () => {
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  assert.equal(resolveOptions({ demo: "0" }).demo, false)
  assert.equal(resolveOptions({ demo: "maybe" }).demo, false)
  assert.equal(resolveOptions({ cacheSeconds: "600" }).cacheSeconds, 600)
  assert.equal(resolveOptions({ cacheSeconds: 1 }).cacheSeconds, 30)
  assert.equal(resolveOptions({ cacheSeconds: 1e9 }).cacheSeconds, 86_400)
  assert.equal(resolveOptions({ cacheSeconds: "five" }).cacheSeconds, 300)
  assert.equal(resolveOptions({ maxPages: 0 }).maxPages, 1)
  assert.equal(resolveOptions({ requestsPerSecond: 500 }).requestsPerSecond, 50)
  assert.equal(resolveOptions({ timeoutMs: 10 }).timeoutMs, 2000)
  assert.equal(resolveOptions({ checks: { domains: false, deliveries: "false", webhook: "yes" } }).checks.domains, false)
  assert.equal(resolveOptions({ checks: { domains: false, deliveries: "false" } }).checks.deliveries, false)
  assert.equal(resolveOptions({ checks: { webhook: "yes" } }).checks.webhook, true)
  assert.equal(bool(undefined, true), true)
  assert.equal(bool(1, false), true)
})

test("the provider id, the backend URL and the storefront domains are checked", () => {
  assert.equal(resolveOptions({ providerId: "stripe-test" }).providerId, "stripe-test")
  assert.equal(resolveOptions({ providerId: "../x" }).providerId, "stripe")
  assert.equal(resolveOptions({ providerId: "" }).providerId, "stripe")
  assert.equal(baseUrl("https://api.kodasupply.example/"), "https://api.kodasupply.example")
  assert.equal(baseUrl("https://kodasupply.example/api/"), "https://kodasupply.example/api")
  assert.equal(baseUrl("ftp://kodasupply.example"), null)
  assert.equal(baseUrl("not a url"), null)
  assert.deepEqual(domainList("kodasupply.example, https://www.kodasupply.example/checkout, localhost, bad domain"), ["kodasupply.example", "www.kodasupply.example"])
  assert.deepEqual(domainList(["Shop.Example", "shop.example"]), ["shop.example"])
  assert.equal(domainList(undefined), null)
  assert.deepEqual(resolveOptions({ storefrontDomains: [] }).storefrontDomains, [])
})

test("storefront domains from STORE_CORS: http(s) origins only, no localhost, IPs or patterns", () => {
  assert.deepEqual(domainsFromCors("http://localhost:8000,https://kodasupply.example,https://www.kodasupply.example,/vercel\\.app$/,http://127.0.0.1:3000,https://*.kodasupply.example"), ["kodasupply.example", "www.kodasupply.example"])
  assert.deepEqual(domainsFromCors(undefined), [])
  assert.deepEqual(domainsFromCors(""), [])
})

test("the key: kind, mode and last four characters, never more", () => {
  assert.deepEqual(keyInfo(READ_KEY), { kind: "restricted", mode: "live", last4: READ_KEY.slice(-4) })
  assert.deepEqual(keyInfo("sk_test_TESTONLY0000"), { kind: "secret", mode: "test", last4: "0000" })
  assert.equal(keyInfo("pk_live_TESTONLYxxxxxxxxxxxxxxxx").kind, "publishable")
  assert.equal(keyInfo("whatever-1234567890").kind, "unknown")
  assert.deepEqual(keyInfo(""), { kind: null, mode: null, last4: null })
  assert.equal(keyInfo("rk_live_x").last4, null, "a short value shows nothing")
})

test("masking: the key itself, every Stripe secret by its shape, bearer tokens; ids stay readable", () => {
  const text = `key ${READ_KEY}, other sk_live_TESTONLYzzzz, hook whsec_TESTONLYabc123, intent pi_3Fixture_secret_Abc123, Bearer abc.def, id pi_3FixtureAbcdef, acct_Fixture`
  const masked = maskSecrets(text, [READ_KEY])
  assert.ok(!masked.includes(READ_KEY))
  assert.ok(!masked.includes("TESTONLYzzzz"))
  assert.ok(!masked.includes("whsec_TESTONLY"))
  assert.ok(!masked.includes("_secret_Abc123"))
  assert.ok(masked.includes("Bearer ***"))
  assert.ok(masked.includes("pi_3FixtureAbcdef"))
  assert.ok(masked.includes("acct_Fixture"))
})

test("ids for URL paths and permissions from Stripe's messages", () => {
  assert.equal(safeStripeId("pi_3FixtureAbcdef", "pi"), "pi_3FixtureAbcdef")
  assert.equal(safeStripeId("pi_../../x", "pi"), null)
  assert.equal(safeStripeId("ch_3FixtureAbcdef", "pi"), null)
  assert.equal(safeStripeId(42, "pi"), null)
  assert.equal(permissionFrom("Having the 'rak_charge_read' permission would allow this request to continue."), "rak_charge_read")
  assert.equal(permissionFrom("nothing here"), null)
})

test("a references key left over from an older config is ignored, never an error", () => {
  const o = resolveOptions({ references: [{ name: "Store", url: "https://store.example" }] } as never)
  assert.equal("references" in o, false)
})

test("demo only with demo: true; a missing key never turns a store into sample data; demoOrders defaults to stripe", () => {
  assert.equal(resolveOptions({}).demo, false)
  assert.equal(resolveOptions({ apiKey: "" }).demo, false)
  assert.equal(resolveOptions({ demo: undefined }).demo, false)
  assert.equal(resolveOptions({ demo: "maybe" }).demo, false)
  assert.equal(resolveOptions({}).demoOrders, "stripe")
  assert.equal(resolveOptions({ demoOrders: "stripe-or-none" }).demoOrders, "stripe-or-none")
  assert.equal(resolveOptions({ demoOrders: " STRIPE-OR-NONE " }).demoOrders, "stripe-or-none")
  assert.equal(resolveOptions({ demoOrders: "all" }).demoOrders, "stripe")
})

test("the start log: a warning for demo mode in production, and no promise that a restricted key is read only", async () => {
  const { default: Service } = await import("../src/modules/stripe/service.ts")
  const lines: string[] = []
  const logger = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`), error() {}, debug() {} }
  const env = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = "production"
    new Service({ logger: logger as never }, { demo: true })
    assert.ok(lines.some((l) => l.startsWith("warn") && l.includes("production")), lines.join("\n"))
    lines.length = 0
    process.env.NODE_ENV = "development"
    new Service({ logger: logger as never }, { demo: true })
    assert.ok(!lines.some((l) => l.startsWith("warn")))
    lines.length = 0
    new Service({ logger: logger as never }, { apiKey: READ_KEY })
    assert.ok(lines.some((l) => l.includes("Read or None")), lines.join("\n"))
    assert.ok(!lines.some((l) => /read only\.?$/.test(l)))
    lines.length = 0
    new Service({ logger: logger as never }, { apiKey: "sk_live_FAKEsecretKey1234" })
    assert.ok(lines.some((l) => l.startsWith("warn") && l.includes("secret")))
    assert.ok(!lines.join("\n").includes("FAKEsecretKey1234"))
  } finally {
    process.env.NODE_ENV = env
  }
})
