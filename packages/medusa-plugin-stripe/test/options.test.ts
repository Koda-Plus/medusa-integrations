import { test } from "node:test"
import assert from "node:assert/strict"
import { baseUrl, bool, domainList, domainsFromCors, missingOptions, resolveOptions } from "../src/modules/stripe/lib/options.ts"
import { normalizeReferences, normalizeReview, pickText } from "../src/modules/stripe/lib/references.ts"
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
  assert.deepEqual(o.references, [])
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

/* References: the same parser and rules as the other Koda Plus integrations. */

test("references: entries without a name or an https URL are dropped, parts are cleaned, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Koda Supply",
      url: "https://kodasupply.example",
      description: { en: "Tools wholesale", pl: "Hurtownia narzędzi" },
      metrics: [{ label: { en: "methods", pl: "metod" }, value: "5" }, { label: "broken" }],
      links: [{ label: "Checkout", url: "https://kodasupply.example/checkout" }, { label: "Insecure", url: "http://x.example" }],
    },
    { name: "No URL" },
    { name: "Plain http", url: "http://shop.example" },
    { name: "", url: "https://shop.example" },
    { name: "Duplicate", url: "https://kodasupply.example" },
    "not an object",
    { name: "Same text", url: "https://other.example", description: "Same in both" },
  ])
  assert.equal(refs.length, 2)
  assert.equal(refs[0].soon, false)
  assert.equal(refs[0].metrics.length, 1)
  assert.equal(refs[0].links.length, 1)
  assert.deepEqual(refs[1].description, { en: "Same in both", pl: "Same in both" })
  assert.deepEqual(normalizeReferences("nope"), [])
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.equal(resolveOptions({ references: [{ name: "A", url: "https://a.example" }] }).references.length, 1)
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
})

test("references: a store that starts soon needs only its name, a live one still needs an https URL", () => {
  const refs = normalizeReferences([
    { name: "Soon, no address", soon: true, description: "Opens in spring" },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Soon, insecure address", soon: true, url: "http://soon.example.com" },
    { name: "Live, no address" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Soon, insecure address", soon: true, url: null },
    ],
  )
  assert.equal(normalizeReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
})

test("references: the since date of an older config is ignored, never an error; texts in the admin language", () => {
  const refs = normalizeReferences([
    { name: "Live", url: "https://a.example", since: "2026-04" },
    { name: "Soon", soon: true, since: { not: "a month" } },
  ])
  assert.equal(refs.length, 2)
  for (const r of refs) assert.equal("since" in r, false)
  assert.equal(pickText({ en: "Tools", pl: "Narzędzia" }, "pl"), "Narzędzia")
  assert.equal(pickText({ en: "Tools", pl: "Narzędzia" }, "en-US"), "Tools")
  assert.equal(pickText({ pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(pickText(null, "pl"), "")
})
