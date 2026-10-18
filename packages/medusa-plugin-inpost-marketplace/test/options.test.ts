/**
 * The options and the modes: off without credentials, demo only on explicit
 * request (and it wins over the credentials), sandbox and live with their
 * own complete set, lenient values that never throw.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { callsMarketplace, isActive, mask, missingOptions, resolveOptions } from "../src/modules/vonhalsky/lib/options.ts"

const SANDBOX = { apiUrl: "https://sandbox.example.com/api/", organizationId: "org-1", accessToken: "token-abcdefgh" }
const LIVE = { apiUrl: "https://api.example.com", organizationId: "org-2", accessToken: "token-live-1234" }

test("options: nothing set is off, never a throw", () => {
  for (const input of [undefined, null, {}, "nonsense" as never, 42 as never]) {
    const o = resolveOptions(input)
    assert.equal(o.mode, "off")
    assert.equal(isActive(o), false)
    assert.equal(callsMarketplace(o), false)
  }
  assert.deepEqual(missingOptions(resolveOptions({})), ["sandbox.apiUrl", "sandbox.organizationId", "sandbox.accessToken"])
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

test("options: sandbox is the default environment, live needs its own credentials", () => {
  const sandbox = resolveOptions({ sandbox: SANDBOX })
  assert.equal(sandbox.mode, "sandbox")
  assert.equal(sandbox.credentials.apiUrl, "https://sandbox.example.com/api")
  assert.equal(resolveOptions({ sandbox: SANDBOX, environment: "live" }).mode, "off", "sandbox credentials never serve live")
  assert.deepEqual(missingOptions(resolveOptions({ sandbox: SANDBOX, environment: "live" })), ["live.apiUrl", "live.organizationId", "live.accessToken"])
  const live = resolveOptions({ sandbox: SANDBOX, live: LIVE, environment: "live" })
  assert.equal(live.mode, "live")
  assert.equal(live.credentials.organizationId, "org-2")
  assert.equal(resolveOptions({ sandbox: { ...SANDBOX, accessToken: "" } }).mode, "off")
})

test("options: bad values fall back and are listed, numbers are clamped", () => {
  const o = resolveOptions({ sandbox: { ...SANDBOX, apiUrl: "ftp://nope" }, environment: "prod", markupPercent: "1000", vatRate: "x", salesChannelId: "channel", stockLocationIds: "sloc_1, bad id ,sloc_2" })
  assert.equal(o.mode, "off", "an address that is not https is ignored")
  assert.equal(o.environment, "sandbox")
  assert.equal(o.markupPercent, 300)
  assert.equal(o.vatRate, 23)
  assert.equal(o.salesChannelId, null)
  assert.deepEqual(o.stockLocationIds, ["sloc_1", "sloc_2"])
  assert.equal(o.problems.length, 3)
  assert.equal(resolveOptions({ markupPercent: "12,5" }).markupPercent, 12.5)
  assert.equal(resolveOptions({ pricesIncludeTax: "true" }).pricesIncludeTax, true)
  assert.equal(resolveOptions({}).pricesIncludeTax, null)
  assert.equal(resolveOptions({ sendTracking: "true" }).sendTracking, true)
  assert.equal(resolveOptions({}).sendTracking, false)
  assert.equal(resolveOptions({ brandKey: "marka" }).brandKey, "marka")
  assert.equal(resolveOptions({ brandKey: "not ok!" }).brandKey, "brand")
})

test("options: the token is masked to the last four characters", () => {
  assert.equal(mask("token-abcdefgh"), "***efgh")
  assert.equal(mask("short"), "***")
  assert.equal(mask(""), "")
})
