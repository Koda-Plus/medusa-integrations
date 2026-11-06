/**
 * The Geowidget token of the storefront map: read from its public JWT payload,
 * never needed to ship, shown in Settings without the whole token.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { geowidgetHost, readGeowidgetToken } from "../src/modules/inpost/lib/geowidget.ts"
import { resolveOptions } from "../src/modules/inpost/lib/options.ts"

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
const jwt = (payload: unknown) => `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(payload)}.signature-part`

test("a sandbox token: environment, domains, expiry and a short preview", () => {
  const token = jwt({ iss: "https://sandbox-login.inpost.pl/auth/realms/external", exp: 2108989385, allowed_referrers: "demo.koda.plus, https://Shop.example.com/x" })
  const g = readGeowidgetToken(token, new Date("2026-11-06T12:00:00Z"))
  assert.equal(g.set, true)
  assert.equal(g.readable, true)
  assert.equal(g.environment, "sandbox")
  assert.deepEqual(g.domains, ["demo.koda.plus", "shop.example.com"])
  assert.equal(g.expiresAt, new Date(2108989385 * 1000).toISOString())
  assert.equal(g.expired, false)
  assert.ok(g.preview && g.preview.length < 20 && !g.preview.includes("signature-part"))
})

test("a production token, an expired one, a list of referrers", () => {
  const g = readGeowidgetToken(jwt({ iss: "https://login.inpost.pl/auth/realms/external", exp: 1700000000, allowed_referrers: ["a.pl", "a.pl", "b.pl"] }), new Date("2026-11-06T12:00:00Z"))
  assert.equal(g.environment, "production")
  assert.equal(g.expired, true)
  assert.deepEqual(g.domains, ["a.pl", "b.pl"])
})

test("no token, and a value that is no JWT: kept, shown as unreadable, never throws", () => {
  assert.equal(readGeowidgetToken("").set, false)
  assert.equal(readGeowidgetToken(undefined).set, false)
  const bad = readGeowidgetToken("not-a-token-at-all-really")
  assert.equal(bad.set, true)
  assert.equal(bad.readable, false)
  assert.equal(bad.environment, null)
})

test("the option is read leniently and the script host follows the environment", () => {
  assert.equal(resolveOptions({ geowidgetToken: "  eyJx  " }).geowidgetToken, "eyJx")
  assert.equal(resolveOptions(undefined).geowidgetToken, "")
  assert.equal(geowidgetHost("sandbox", false), "https://sandbox-easy-geowidget-sdk.easypack24.net")
  assert.equal(geowidgetHost("production", true), "https://geowidget.inpost.pl")
  assert.equal(geowidgetHost(null, true), "https://sandbox-easy-geowidget-sdk.easypack24.net")
})
