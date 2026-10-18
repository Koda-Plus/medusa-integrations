/**
 * The options and the modes: off without keys, demo only on explicit
 * request (and it wins over the keys), sandbox and live with the three
 * keys, the InPost addresses of each, lenient values that never throw.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { callsInpost, isActive, mask, missingOptions, resolveOptions } from "../src/modules/inpostpay/lib/options.ts"
import { DEFAULT_PROVIDER_ID, INPOST_URLS } from "../src/modules/inpostpay/lib/constants.ts"

const KEYS = { clientId: "client-1", clientSecret: "secret-abcdef", merchantClientId: "merchant-1" }

test("options: nothing set is off, never a throw", () => {
  for (const input of [undefined, null, {}, "nonsense" as never, 42 as never]) {
    const o = resolveOptions(input)
    assert.equal(o.mode, "off")
    assert.equal(isActive(o), false)
    assert.equal(callsInpost(o), false)
  }
  assert.deepEqual(missingOptions(resolveOptions({})), ["clientId", "clientSecret", "merchantClientId"])
})

test("options: demo only on explicit request, and it wins over the keys", () => {
  assert.equal(resolveOptions({ demo: true }).mode, "demo")
  assert.equal(resolveOptions({ demo: "true" }).mode, "demo")
  assert.equal(resolveOptions({ demo: "false" }).mode, "off")
  assert.equal(resolveOptions({ demo: "yes" as never }).mode, "off")
  const both = resolveOptions({ ...KEYS, demo: true })
  assert.equal(both.mode, "demo")
  assert.equal(callsInpost(both), false)
  assert.deepEqual(missingOptions(both), [])
})

test("options: the three keys make live, sandbox switches the addresses", () => {
  const live = resolveOptions(KEYS)
  assert.equal(live.mode, "live")
  assert.equal(live.apiUrl, INPOST_URLS.live.api)
  assert.equal(live.tokenUrl, INPOST_URLS.live.token)
  assert.equal(live.widgetUrl, INPOST_URLS.live.widget)
  const sandbox = resolveOptions({ ...KEYS, sandbox: "true" })
  assert.equal(sandbox.mode, "sandbox")
  assert.equal(sandbox.apiUrl, "https://sandbox-api.inpost.pl")
  assert.equal(sandbox.tokenUrl, "https://sandbox-login.inpost.pl/auth/realms/external/protocol/openid-connect/token")
  assert.equal(resolveOptions({ clientId: "a", clientSecret: "b" }).mode, "off")
})

test("options: bad values fall back and are listed, numbers are clamped", () => {
  const o = resolveOptions({ ...KEYS, apiUrl: "not a url", paymentProviderId: "stripe", basketTtlHours: "9999", shippingVatRate: "x", timeoutMs: 5 })
  assert.equal(o.apiUrl, INPOST_URLS.live.api)
  assert.equal(o.paymentProviderId, DEFAULT_PROVIDER_ID)
  assert.equal(o.basketTtlHours, 720)
  assert.equal(o.shippingVatRate, 23)
  assert.equal(o.timeoutMs, 1000)
  assert.equal(o.problems.length, 2)
  assert.equal(resolveOptions({ backendUrl: "https://api.example.com/" }).backendUrl, "https://api.example.com")
  assert.equal(resolveOptions({ sendOrderEvents: "true" }).sendOrderEvents, true)
  assert.equal(resolveOptions({}).sendOrderEvents, false)
})

test("options: secrets are masked to the last four characters", () => {
  assert.equal(mask("secret-abcdef"), "***cdef")
  assert.equal(mask("abc"), "***")
  assert.equal(mask(""), "")
})
