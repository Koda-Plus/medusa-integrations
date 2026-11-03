/**
 * The options and the modes: off without credentials, demo only on explicit
 * request (and it wins over the credentials), sandbox and live with their
 * own complete set of API application credentials (client id, client
 * secret, organization id) and InPost's addresses by default, lenient
 * values that never throw, and the offer options (days to ship, price and
 * stock sync, VAT key, units).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { callsMarketplace, complete, ENDPOINTS, isActive, mask, missingOptions, resolveOptions } from "../src/modules/vonhalsky/lib/options.ts"

const SANDBOX = { clientId: "client-sandbox", clientSecret: "secret-sandbox-1234", organizationId: "org-1" }
const LIVE = { clientId: "client-live", clientSecret: "secret-live-5678", organizationId: "org-2" }

test("options: nothing set is off, never a throw", () => {
  for (const input of [undefined, null, {}, "nonsense" as never, 42 as never]) {
    const o = resolveOptions(input)
    assert.equal(o.mode, "off")
    assert.equal(isActive(o), false)
    assert.equal(callsMarketplace(o), false)
  }
  assert.deepEqual(missingOptions(resolveOptions({})), ["sandbox.clientId", "sandbox.clientSecret", "sandbox.organizationId"])
})

test("options: demo only on explicit request, and it wins over the credentials", () => {
  assert.equal(resolveOptions({ demo: true }).mode, "demo")
  assert.equal(resolveOptions({ demo: "true" }).mode, "demo")
  assert.equal(resolveOptions({ demo: "false" }).mode, "off")
  assert.equal(resolveOptions({ demo: "yes" as never }).mode, "off")
  const both = resolveOptions({ sandbox: SANDBOX, live: LIVE, environment: "live", demo: true })
  assert.equal(both.mode, "demo")
  assert.equal(callsMarketplace(both), false)
  assert.deepEqual(missingOptions(both), [])
})

test("options: sandbox is the default environment and talks to InPost's stage addresses", () => {
  const sandbox = resolveOptions({ sandbox: SANDBOX })
  assert.equal(sandbox.mode, "sandbox")
  assert.equal(sandbox.environment, "sandbox")
  assert.equal(callsMarketplace(sandbox), true)
  assert.deepEqual(sandbox.credentials, { ...SANDBOX, apiUrl: ENDPOINTS.sandbox.apiUrl, tokenUrl: ENDPOINTS.sandbox.tokenUrl })
  assert.equal(complete(sandbox.credentials), true)
})

test("options: live needs its own credentials and uses the production addresses", () => {
  assert.equal(resolveOptions({ sandbox: SANDBOX, environment: "live" }).mode, "off", "sandbox credentials never serve live")
  assert.deepEqual(missingOptions(resolveOptions({ sandbox: SANDBOX, environment: "live" })), ["live.clientId", "live.clientSecret", "live.organizationId"])
  const live = resolveOptions({ sandbox: SANDBOX, live: LIVE, environment: "live" })
  assert.equal(live.mode, "live")
  assert.equal(live.credentials.organizationId, "org-2")
  assert.equal(live.credentials.apiUrl, ENDPOINTS.live.apiUrl)
  assert.equal(live.credentials.tokenUrl, ENDPOINTS.live.tokenUrl)
})

test("options: each missing credential turns the plugin off and is named", () => {
  for (const key of ["clientId", "clientSecret", "organizationId"] as const) {
    const o = resolveOptions({ sandbox: { ...SANDBOX, [key]: "" } })
    assert.equal(o.mode, "off", key)
    assert.deepEqual(missingOptions(o), [`sandbox.${key}`])
  }
})

test("options: own addresses must be https (or local http) and lose the trailing slash", () => {
  const own = resolveOptions({ sandbox: { ...SANDBOX, apiUrl: "https://sandbox.example.com/api/", tokenUrl: "https://auth.example.com/token" } })
  assert.equal(own.credentials.apiUrl, "https://sandbox.example.com/api")
  assert.equal(own.credentials.tokenUrl, "https://auth.example.com/token")
  assert.deepEqual(own.problems, [])
  assert.equal(resolveOptions({ sandbox: { ...SANDBOX, apiUrl: "http://localhost:9010/inpsa" } }).credentials.apiUrl, "http://localhost:9010/inpsa")
  const bad = resolveOptions({ sandbox: { ...SANDBOX, apiUrl: "ftp://nope.example.com", tokenUrl: "http://auth.example.com/token" } })
  assert.equal(bad.credentials.apiUrl, ENDPOINTS.sandbox.apiUrl, "a bad address falls back to InPost's own")
  assert.equal(bad.credentials.tokenUrl, ENDPOINTS.sandbox.tokenUrl)
  assert.deepEqual(bad.problems, ["sandbox.apiUrl (an https address)", "sandbox.tokenUrl (an https address)"])
})

test("options: bad values fall back and are listed, numbers are clamped", () => {
  const o = resolveOptions({ sandbox: SANDBOX, environment: "prod", markupPercent: "1000", vatRate: "x", salesChannelId: "channel", regionId: "region", stockLocationIds: "sloc_1, bad id ,sloc_2" })
  assert.equal(o.environment, "sandbox")
  assert.equal(o.mode, "sandbox")
  assert.equal(o.markupPercent, 300)
  assert.equal(o.vatRate, 23)
  assert.equal(o.salesChannelId, null)
  assert.equal(o.regionId, null)
  assert.deepEqual(o.stockLocationIds, ["sloc_1", "sloc_2"])
  assert.deepEqual(o.problems, ["environment (sandbox or live)", "salesChannelId (a sales channel id like sc_...)", "regionId (a region id like reg_...)"])
  assert.equal(resolveOptions({ markupPercent: "12,5" }).markupPercent, 12.5)
  assert.equal(resolveOptions({ pricesIncludeTax: "true" }).pricesIncludeTax, true)
  assert.equal(resolveOptions({ pricesIncludeTax: false }).pricesIncludeTax, false)
  assert.equal(resolveOptions({}).pricesIncludeTax, null)
  assert.equal(resolveOptions({ brandKey: "marka" }).brandKey, "marka")
  assert.equal(resolveOptions({ brandKey: "not ok!" }).brandKey, "brand")
  assert.equal(resolveOptions({ timeoutMs: "10" }).timeoutMs, 1000)
  assert.equal(resolveOptions({ timeoutMs: 999_999 }).timeoutMs, 60_000)
  assert.equal(resolveOptions({}).timeoutMs, 15_000)
})

test("options: the offer options have defaults, are clamped and accept strings", () => {
  const d = resolveOptions({})
  assert.equal(d.daysToShip, 2)
  assert.equal(d.syncPriceStock, true, "price and stock sync is on unless switched off")
  assert.equal(d.vatKey, "vat_rate")
  assert.equal(d.dimensionUnit, "mm")
  assert.equal(d.weightUnit, "g")
  assert.equal(d.autoImport, false)
  assert.equal(resolveOptions({ daysToShip: "3.6" }).daysToShip, 4)
  assert.equal(resolveOptions({ daysToShip: 99 }).daysToShip, 60)
  assert.equal(resolveOptions({ daysToShip: -1 }).daysToShip, 0)
  assert.equal(resolveOptions({ syncPriceStock: "false" }).syncPriceStock, false)
  assert.equal(resolveOptions({ syncPriceStock: false }).syncPriceStock, false)
  assert.equal(resolveOptions({ syncPriceStock: "true" }).syncPriceStock, true)
  assert.equal(resolveOptions({ vatKey: "stawka_vat" }).vatKey, "stawka_vat")
  assert.equal(resolveOptions({ vatKey: "bad key" }).vatKey, "vat_rate")
  const units = resolveOptions({ dimensionUnit: "CM", weightUnit: "kg" })
  assert.equal(units.dimensionUnit, "cm")
  assert.equal(units.weightUnit, "kg")
  assert.deepEqual(units.problems, [])
  const wrong = resolveOptions({ dimensionUnit: "inch", weightUnit: "lb" })
  assert.equal(wrong.dimensionUnit, "mm")
  assert.equal(wrong.weightUnit, "g")
  assert.deepEqual(wrong.problems, ["dimensionUnit (mm or cm)", "weightUnit (g or kg)"])
})

test("options: a secret is masked to the last four characters", () => {
  assert.equal(mask("secret-sandbox-1234"), "***1234")
  assert.equal(mask("short"), "***")
  assert.equal(mask(""), "")
})
