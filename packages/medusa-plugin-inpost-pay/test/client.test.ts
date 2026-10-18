/**
 * The Basket App clients. The demo client never calls fetch; the live client
 * asks for an OAuth token once, uses InPost's paths and masks the secret in
 * every error.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDemoBasketAppClient, demoBindingKey } from "../src/modules/inpostpay/lib/demo.ts"
import { createBasketAppClient, InpostPayApiError, maskSecrets } from "../src/modules/inpostpay/lib/client.ts"

test("demo client: every call works and fetch is never touched", async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error("fetch must not be called in demo mode")
  }) as typeof fetch
  try {
    const c = createDemoBasketAppClient()
    assert.equal(c.mode, "demo")
    assert.deepEqual(await c.check(), { ok: true, expiresIn: null })
    const a = await c.bind("ipbsk_1")
    const b = await c.bind("ipbsk_1")
    assert.equal(a.basket_binding_api_key, b.basket_binding_api_key, "binding is idempotent")
    assert.equal(a.basket_binding_api_key, demoBindingKey("ipbsk_1"))
    assert.notEqual(demoBindingKey("ipbsk_2"), a.basket_binding_api_key)
    assert.equal((await c.bindingStatus("ipbsk_1")).basket_linked, true)
    await c.updateBasket("ipbsk_1", { summary: {} })
    await c.unbind("ipbsk_1")
    assert.equal((await c.bindingStatus("ipbsk_1")).basket_linked, false)
    await c.orderEvent("order_1", { event_id: "e1", event_data_time: new Date().toISOString(), event_data: { order_status: "ORDER_REJECTED" } })
    await assert.rejects(() => c.signingKey("1"), InpostPayApiError)
    assert.ok(c.log.some((l) => l.call === "order_event"))
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = original
  }
})

type Call = { url: string; method: string; headers: Record<string, string>; body?: string }

function fakeFetch(answer: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body }
    calls.push(call)
    const r = answer(call)
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)) }
  }
  return { fn, calls }
}

const CONFIG = { mode: "sandbox" as const, apiUrl: "https://sandbox-api.inpost.pl", tokenUrl: "https://sandbox-login.inpost.pl/token", clientId: "cid", clientSecret: "very-secret-value", timeoutMs: 5000 }

test("live client: one token for many calls, InPost's paths, the binding key", async () => {
  const f = fakeFetch((c) => {
    if (c.url.endsWith("/token")) return { status: 200, body: { access_token: "tok-1", expires_in: 300 } }
    if (c.url.endsWith("/binding") && c.method === "PUT") return { status: 200, body: { basket_binding_api_key: "key-1" } }
    if (c.url.includes("/signing-keys/public/")) return { status: 200, body: { public_key_base64: "AAAA", merchant_external_id: "m-1" } }
    return { status: 200, body: {} }
  })
  const c = createBasketAppClient({ ...CONFIG, fetch: f.fn })
  assert.deepEqual(await c.bind("ipbsk_1"), { basket_binding_api_key: "key-1" })
  await c.updateBasket("ipbsk_1", { summary: { currency: "PLN" } })
  await c.orderEvent("order_1", { event_id: "e", event_data_time: "2026-10-18T10:00:00.000Z", event_data: { order_status: "ORDER_REJECTED" } })
  assert.deepEqual(await c.signingKey("2"), { public_key_base64: "AAAA", merchant_external_id: "m-1" })
  const tokenCalls = f.calls.filter((x) => x.url.endsWith("/token"))
  assert.equal(tokenCalls.length, 1, "the token is reused")
  assert.match(tokenCalls[0].body ?? "", /grant_type=client_credentials/)
  assert.equal(tokenCalls[0].headers["Content-Type"], "application/x-www-form-urlencoded")
  const api = f.calls.filter((x) => !x.url.endsWith("/token"))
  assert.deepEqual(
    api.map((x) => `${x.method} ${x.url.replace(CONFIG.apiUrl, "")}`),
    ["PUT /v2/izi/basket/ipbsk_1/binding", "PUT /v2/izi/basket/ipbsk_1", "POST /v1/izi/order/order_1/event", "GET /v1/izi/signing-keys/public/2"],
  )
  for (const x of api) assert.equal(x.headers.Authorization, "Bearer tok-1")
  assert.equal(api[0].body, undefined, "the binding call has no body")
})

test("live client: errors are typed and never carry the secret", async () => {
  const f = fakeFetch((c) => (c.url.endsWith("/token") ? { status: 401, body: { error_description: "Invalid client secret very-secret-value" } } : { status: 200, body: {} }))
  const c = createBasketAppClient({ ...CONFIG, fetch: f.fn })
  await assert.rejects(
    () => c.check(),
    (e: unknown) => {
      assert.ok(e instanceof InpostPayApiError)
      assert.equal(e.kind, "auth")
      assert.ok(!e.message.includes("very-secret-value"))
      return true
    },
  )
  assert.equal(maskSecrets("Bearer abc.def and client_secret=xyz", []), "Bearer *** and client_secret=***")
})
