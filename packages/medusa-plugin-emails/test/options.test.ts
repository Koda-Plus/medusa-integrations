/**
 * Options: defaults, the three modes, links with placeholders, template
 * switches and definitions, references, and the rule that nothing here ever
 * throws.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildLink,
  fingerprintDifferences,
  missingOptions,
  optionsFingerprint,
  recommendedOptions,
  resolveLinkTemplate,
  resolveOptions,
  SYSTEM_FONTS,
} from "../src/modules/emails/lib/options.ts"
import { resolveReferences } from "../src/modules/emails/lib/references.ts"
import { LIVE } from "./helpers.ts"

test("defaults: dev mode without a key, English, UTC, safe limits, every switch untouched", () => {
  const o = resolveOptions(undefined)
  assert.equal(o.mode, "dev")
  assert.equal(o.demo, false)
  assert.equal(o.apiKey, "")
  assert.equal(o.sender, null)
  assert.equal(o.defaultLocale, "en")
  assert.equal(o.timeZone, "UTC")
  assert.equal(o.storefrontUrl, null)
  assert.deepEqual(o.links, { store: null, account: null, order: null, cart: null, passwordReset: null, adminPasswordReset: null, negotiation: null })
  assert.deepEqual(o.switches, {})
  assert.deepEqual(o.abandonedCart, { afterHours: 24, maxAgeHours: 72, maxPerRun: 50 })
  assert.deepEqual(o.skipOrderMetadataKeys, ["marketplace_order_ref"])
  assert.equal(o.requestsPerSecond, 5)
  assert.equal(o.maxRetries, 2)
  assert.equal(o.timeoutMs, 15000)
  assert.equal(o.passwordResetMinutes, 15)
  assert.equal(o.negotiationAmounts, "major")
  assert.equal(o.logRetentionDays, 365)
  assert.equal(o.brand.bodyFont, SYSTEM_FONTS)
  assert.deepEqual(o.references, [])
  assert.deepEqual(o.problems, [])
  assert.deepEqual(missingOptions(o), ["apiKey", "from"])
})

test("modes: demo whatever the key, live with a key; live needs a valid From", () => {
  assert.equal(resolveOptions({ demo: true, apiKey: "re_x" }).mode, "demo")
  assert.deepEqual(missingOptions(resolveOptions({ demo: true })), [])
  const o = resolveOptions({ apiKey: "re_live_123" })
  assert.equal(o.mode, "live")
  assert.deepEqual(missingOptions(o), ["from"])
  assert.deepEqual(missingOptions(resolveOptions(LIVE)), [])
})

test("From and Reply-To: a name with punctuation is quoted, bad values are listed as problems", () => {
  assert.equal(resolveOptions({ from: "Koda Supply <orders@mail.example.com>" }).sender?.value, "Koda Supply <orders@mail.example.com>")
  assert.equal(resolveOptions({ from: "Kowalski, Sklep <a@b.pl>" }).sender?.value, '"Kowalski, Sklep" <a@b.pl>')
  assert.equal(resolveOptions({ from: "orders@mail.example.com" }).sender?.domain, "mail.example.com")
  const bad = resolveOptions({ from: "nope", replyTo: ["x", 3 as unknown as string] })
  assert.equal(bad.sender, null)
  assert.ok(bad.problems.some((p) => p.startsWith("from")))
  assert.ok(bad.problems.some((p) => p.startsWith("replyTo")))
  assert.deepEqual(resolveOptions({ replyTo: "a@x.pl; b@x.pl, a@x.pl" }).replyTo, ["a@x.pl", "b@x.pl"])
})

test("links: defaults from the storefront, paths joined to it, placeholders checked", () => {
  const o = resolveOptions({ storefrontUrl: "https://shop.example.com/", links: { order: "/{country}/account/orders/details/{order_id}", cart: "javascript:alert(1)" } })
  assert.equal(o.storefrontUrl, "https://shop.example.com")
  assert.equal(o.links.store, "https://shop.example.com")
  assert.equal(o.links.account, "https://shop.example.com/account")
  assert.equal(o.links.order, "https://shop.example.com/{country}/account/orders/details/{order_id}")
  assert.equal(o.links.cart, "https://shop.example.com/cart", "an invalid link falls back to the default")
  assert.ok(o.problems.some((p) => p.startsWith("links.cart")))
  assert.equal(o.links.passwordReset, "https://shop.example.com/reset-password?token={token}&email={email}")
  assert.equal(resolveLinkTemplate("https://x.example.com/{unknown}", null), null)
  assert.equal(resolveLinkTemplate("/relative", null), null, "a path needs a storefront")
})

test("buildLink encodes every value and leaves no double slash for an empty one", () => {
  assert.equal(buildLink("https://s.example.com/{country}/account/orders/{order_id}", { country: "pl", order_id: "order_1" }), "https://s.example.com/pl/account/orders/order_1")
  assert.equal(buildLink("https://s.example.com/{country}/account", { country: null }), "https://s.example.com/account")
  assert.equal(
    buildLink("https://s.example.com/reset?token={token}&email={email}", { token: "a b&c", email: "x+y@ex.com" }),
    "https://s.example.com/reset?token=a%20b%26c&email=x%2By%40ex.com",
  )
  assert.equal(buildLink(null, {}), null)
})

test("templates: false is a hard switch, true turns an optional one on, a definition adds a template", () => {
  const def = { render: () => ({ subject: "S", html: "<p>x</p>" }) }
  const o = resolveOptions({ templates: { "order.canceled": false, "cart.abandoned": true, "company.approved": def, "bad key!": true, "x.y": "nope" as unknown as boolean } })
  assert.deepEqual(o.switches, { "order.canceled": false, "cart.abandoned": true })
  assert.deepEqual(Object.keys(o.definitions), ["company.approved"])
  assert.equal(o.problems.filter((p) => p.startsWith("templates")).length, 2)
})

test("nothing throws, whatever the options are", () => {
  const junk: unknown[] = [null, 42, "x", [], { brand: "x" }, { links: 5 }, { templates: [] }, { abandonedCart: { afterHours: "a" } }, { timeZone: "Mars/Olympus" }, { brand: { fontFaces: [{ family: "<x>", url: "http://x" }] } }, { references: [{ name: "x" }] }]
  for (const j of junk) assert.doesNotThrow(() => resolveOptions(j as never))
  const o = resolveOptions({ timeZone: "Mars/Olympus", brand: { accentColor: "green", headerColor: "#12", supportEmail: "x", fontFaces: [{ family: "Inter", url: "http://insecure.example.com/f.woff2" }] } })
  assert.equal(o.timeZone, "UTC")
  assert.equal(o.brand.accentColor, null)
  assert.equal(o.brand.headerColor, null)
  assert.equal(o.brand.supportEmail, null)
  assert.deepEqual(o.brand.fontFaces, [])
  assert.equal(o.problems.length, 5)
})

test("numbers are clamped: abandoned cart window, retries, rate", () => {
  const o = resolveOptions({ abandonedCart: { afterHours: 48, maxAgeHours: 10, maxPerRun: 99999 }, maxRetries: 50, requestsPerSecond: -3, timeoutMs: 5, logRetentionDays: 0 })
  assert.equal(o.abandonedCart.afterHours, 48)
  assert.equal(o.abandonedCart.maxAgeHours, 49, "the window always has room")
  assert.equal(o.abandonedCart.maxPerRun, 500)
  assert.equal(o.maxRetries, 5)
  assert.equal(o.requestsPerSecond, 5)
  assert.equal(o.timeoutMs, 1000)
  assert.equal(o.logRetentionDays, 0)
})

test("references: none by default, a store that starts soon needs only its name, a live one an https URL", () => {
  const refs = resolveReferences([
    { name: "Soon, no address", soon: true, description: { en: "Opens in spring", pl: "Startuje wiosną" } },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Live", url: "https://live.example.com", since: "2026-04" },
    { name: "Live, no address" },
    { name: "Live, insecure address", url: "http://insecure.example.com" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Live", soon: false, url: "https://live.example.com/" },
    ],
  )
  assert.deepEqual(refs[0].description, { en: "Opens in spring", pl: "Startuje wiosną" })
  for (const r of refs) assert.equal("since" in r, false, "the since date of an older config is ignored")
  assert.equal(resolveReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
})

test("recommended options and the fingerprint of the provider's options", () => {
  assert.deepEqual(recommendedOptions(resolveOptions({})), ["brand.name", "storefrontUrl", "replyTo", "timeZone"])
  assert.deepEqual(recommendedOptions(resolveOptions(LIVE)), [])
  const a = optionsFingerprint(resolveOptions(LIVE))
  const b = optionsFingerprint(resolveOptions({ ...LIVE, apiKey: "re_other_key_42", brand: { name: "Other" } }))
  assert.deepEqual(fingerprintDifferences(a, b), ["apiKey", "brand"])
  assert.ok(!JSON.stringify(a).includes(LIVE.apiKey as string), "the key is never in the fingerprint")
  assert.deepEqual(fingerprintDifferences(a, optionsFingerprint(resolveOptions({ ...LIVE, channels: ["email"] }))), [])
})
