import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { PLUGIN_VERSION } from "../src/modules/allegro/lib/constants.ts"
import { resolveOptions, scopesFor, userAgentFor } from "../src/modules/allegro/lib/options.ts"
import {
  BREAKER_ACTOR,
  afterOutcome,
  armRefusal,
  grantedScopes,
  missingScopes,
  toggledPatch,
  writerState,
} from "../src/modules/allegro/lib/writers.ts"

const FULL = "allegro:api:sale:offers:read allegro:api:sale:offers:write allegro:api:orders:read allegro:api:orders:write"

test("writer state: both switches, a connection and the scopes make a writer effective", () => {
  const s = writerState({ key: "stock", allowed: true, row: { armed: true, mode: "live" }, mode: "live", configured: true, connected: true, scope: FULL })
  assert.equal(s.effective, true)
  assert.deepEqual(s.blockers, [])
})

test("writer state: the hard switch wins over an armed toggle", () => {
  const s = writerState({ key: "stock", allowed: false, row: { armed: true, mode: "live" }, mode: "live", configured: true, connected: true, scope: FULL })
  assert.equal(s.effective, false)
  assert.deepEqual(s.blockers, ["hard_switch"])
  assert.match(armRefusal(s) ?? "", /writes\.stock/)
})

test("writer state: a token without the write scope blocks the writer and names the scope", () => {
  const s = writerState({
    key: "shipping",
    allowed: true,
    row: { armed: true, mode: "live" },
    mode: "live",
    configured: true,
    connected: true,
    scope: "allegro:api:sale:offers:read allegro:api:orders:read",
  })
  assert.equal(s.effective, false)
  assert.deepEqual(s.missingScopes, ["allegro:api:orders:write"])
  assert.match(armRefusal(s) ?? "", /Connect the account again/)
})

test("writer state: a toggle armed in demo mode does not arm a real account", () => {
  const s = writerState({ key: "stock", allowed: true, row: { armed: true, mode: "demo" }, mode: "live", configured: true, connected: true, scope: FULL })
  assert.equal(s.requested, false)
  assert.equal(s.effective, false)
  assert.equal(s.modeChanged, true)
})

test("writer state: demo mode needs no connection and no scopes", () => {
  const s = writerState({ key: "invoices", allowed: true, row: { armed: true, mode: "demo" }, mode: "demo", configured: true, connected: false, scope: null })
  assert.equal(s.effective, true)
  assert.equal(armRefusal(s), null)
})

test("writer state: the order import needs only orders:read", () => {
  const s = writerState({ key: "orders", allowed: true, row: { armed: true, mode: "live" }, mode: "live", configured: true, connected: true, scope: "allegro:api:orders:read" })
  assert.equal(s.effective, true)
})

test("circuit breaker: systemic failures count, item failures do not, a success resets", () => {
  const now = new Date("2026-10-06T10:00:00Z")
  let row = { failure_streak: 0, armed: true }
  for (let i = 1; i <= 4; i += 1) {
    const r = afterOutcome(row, { kind: "systemic", message: "Allegro 503" }, 5, now)
    assert.equal(r.tripped, false)
    row = { ...row, failure_streak: r.patch.failure_streak as number }
  }
  const item = afterOutcome(row, { kind: "item", message: "offer refused" }, 5, now)
  assert.equal(item.tripped, false)
  assert.equal(item.patch.failure_streak, undefined)
  const fifth = afterOutcome(row, { kind: "systemic", message: "Allegro 503" }, 5, now)
  assert.equal(fifth.tripped, true)
  assert.equal(fifth.patch.armed, false)
  assert.equal(fifth.patch.changed_by, BREAKER_ACTOR)
  assert.match(String(fifth.patch.trip_reason), /5 failures in a row.*Allegro 503/)
  assert.deepEqual(afterOutcome(row, { kind: "ok" }, 5, now).patch.failure_streak, 0)
})

test("circuit breaker: a writer that is not armed is never tripped again", () => {
  const r = afterOutcome({ failure_streak: 9, armed: false }, { kind: "systemic", message: "x" }, 5, new Date())
  assert.equal(r.tripped, false)
})

test("arming clears the breaker history and records who and when", () => {
  const now = new Date("2026-10-06T10:00:00Z")
  const p = toggledPatch(true, { id: "user_1", name: "Ola (ola@example.com)" }, now, "live")
  assert.equal(p.armed, true)
  assert.equal(p.failure_streak, 0)
  assert.equal(p.trip_reason, null)
  assert.equal(p.changed_by, "Ola (ola@example.com)")
  assert.equal(p.mode, "live")
  assert.equal(toggledPatch(false, { id: null, name: "x" }, now, "live").failure_streak, undefined)
})

test("scopes: the consent widens only for writers the options allow", () => {
  const readOnly = resolveOptions({})
  assert.equal(scopesFor(readOnly), "allegro:api:sale:offers:read allegro:api:orders:read")
  const stock = resolveOptions({ writes: { stock: true } })
  assert.ok(scopesFor(stock).split(" ").includes("allegro:api:sale:offers:write"))
  assert.ok(!scopesFor(stock).split(" ").includes("allegro:api:orders:write"))
  const shipping = resolveOptions({ ordersEnabled: false, issues: { returns: false }, writes: { shipping: true } })
  assert.deepEqual(scopesFor(shipping).split(" ").sort(), ["allegro:api:orders:read", "allegro:api:orders:write", "allegro:api:sale:offers:read"])
  const issues = resolveOptions({ issues: { disputes: true, messages: true } })
  assert.ok(scopesFor(issues).includes("allegro:api:disputes"))
  assert.ok(scopesFor(issues).includes("allegro:api:messaging"))
})

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }

test("hard switches: false by default live, allowed by default in demo except the order import, explicit false always wins", () => {
  assert.deepEqual(Object.values(resolveOptions({}).writes), [false, false, false, false, false, false])
  const demo = resolveOptions({ demo: true, writes: { prices: false } })
  assert.equal(demo.writes.stock, true)
  assert.equal(demo.writes.prices, false)
  /* Demo orders land in this Medusa store: the import needs its switch even in demo mode. */
  assert.equal(demo.writes.orders, false)
  assert.equal(resolveOptions({ demo: true, writes: { orders: true } }).writes.orders, true)
  assert.equal(resolveOptions({ writes: { orders: "true" as unknown as boolean } }).writes.orders, true)
})

test("demo mode only when switched on: missing keys never start it", () => {
  assert.equal(resolveOptions({}).demo, false)
  assert.equal(resolveOptions({ clientId: "" }).demo, false)
  assert.equal(resolveOptions({ demo: true }).demo, true)
  assert.equal(resolveOptions({ demo: "false" as unknown as boolean }).demo, false)
})

test("the version in the User-Agent and the status is the package version", () => {
  assert.equal(PLUGIN_VERSION, PKG.version)
})

test("options: previous encryption keys (valid ones only) and the tax switch of prices", () => {
  const current = Buffer.alloc(32, 1).toString("base64")
  const old = Buffer.alloc(32, 2).toString("base64")
  const o = resolveOptions({ encryptionKey: current, previousEncryptionKeys: [old, "short", current] })
  assert.deepEqual(o.previousEncryptionKeys, [old])
  assert.equal(resolveOptions({}).prices.taxInclusive, null)
  assert.equal(resolveOptions({ prices: { taxInclusive: true } }).prices.taxInclusive, true)
  assert.equal(resolveOptions({ prices: { taxInclusive: false } }).prices.taxInclusive, false)
})

test("granted scopes parse spaces and commas; missing scopes keep the order needed", () => {
  assert.deepEqual(grantedScopes("a b,c  d"), ["a", "b", "c", "d"])
  assert.deepEqual(missingScopes(["a", "x", "c"], ["a", "c"]), ["x"])
  assert.deepEqual(grantedScopes(null), [])
})

test("user agent: the registered app name, the version and the docs address", () => {
  assert.equal(userAgentFor({ appName: "My Store Allegro", docsUrl: "https://shop.example.com/allegro" }), `My-Store-Allegro/${PKG.version} (+https://shop.example.com/allegro)`)
  assert.equal(userAgentFor({ appName: "Shop", docsUrl: "http://insecure" }), `Shop/${PKG.version} (+https://koda.plus)`)
  assert.equal(userAgentFor({ userAgent: "Custom/1.0 (+https://x.example)" }), "Custom/1.0 (+https://x.example)")
  assert.equal(userAgentFor({}), `KodaPlus-Allegro-Medusa/${PKG.version} (+https://koda.plus)`)
})

test("options: publish location validates the Polish province, invoice kinds are filtered", () => {
  const o = resolveOptions({
    publish: { shippingRatesId: "abc", location: { city: "Warszawa", postCode: "00-001", province: "mazowieckie" } },
    invoiceKinds: ["VAT", "bogus", "correction"] as unknown as Array<"vat">,
  })
  assert.equal(o.publish.location?.province, "MAZOWIECKIE")
  assert.deepEqual(o.invoiceKinds, ["vat", "correction"])
  assert.equal(resolveOptions({ publish: { location: { city: "X", postCode: "1", province: "NOWHERE" } } }).publish.location?.province, null)
  assert.deepEqual(resolveOptions({}).invoiceKinds, ["vat", "correction"])
})
