import { test } from "node:test"
import assert from "node:assert/strict"
import { encodeParams, StripeReadClient, type FetchLike, type FetchResponseLike } from "../src/modules/stripe/lib/client.ts"
import { StripeApiError } from "../src/modules/stripe/lib/errors.ts"
import { TokenBucket, backoffMs, retryAfterMs, type Clock } from "../src/modules/stripe/lib/rate-limit.ts"
import { READ_KEY } from "./fixtures.ts"

interface Call {
  url: string
  method: string
  headers: Record<string, string>
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponseLike {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { status, headers: { get: (name) => h[name.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }
}

/** A scripted Stripe: answers in order, records every call, refuses anything that is not GET. */
function scripted(answers: Array<FetchResponseLike | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    assert.equal(init.method, "GET", "the plugin only reads")
    calls.push({ url, method: init.method, headers: init.headers })
    const next = answers.shift()
    if (!next) throw new Error("no more answers")
    if (next instanceof Error) throw next
    return next
  }
  return { fetch, calls }
}

function fakeClock(): Clock & { slept: number[] } {
  let now = 1_000_000
  const slept: number[] = []
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms)
      now += ms
    },
  }
}

const client = (fetch: FetchLike, clock = fakeClock()) => new StripeReadClient({ apiKey: READ_KEY, fetch, clock, random: () => 0.5, requestsPerSecond: 50 })

test("Stripe's form encoding: nested objects, arrays with indices, booleans, nothing for null", () => {
  assert.equal(encodeParams({ limit: 100, created: { gte: 1700000000 }, expand: ["data.latest_charge", "data.payment_intent"], delivery_success: false, skip: null }), "limit=100&created[gte]=1700000000&expand[0]=data.latest_charge&expand[1]=data.payment_intent&delivery_success=false")
  assert.equal(encodeParams({ type: "payment_intent.*", q: "a b&c" }), "type=payment_intent.*&q=a%20b%26c")
  assert.equal(encodeParams(undefined), "")
})

test("a GET with the key in the header, the pinned version, and the parameters in the query", async () => {
  const s = scripted([response(200, { object: "balance", available: [] })])
  const body = await client(s.fetch).get<{ object: string }>("/balance", { expand: ["available"] })
  assert.equal(body.object, "balance")
  assert.equal(s.calls.length, 1)
  assert.equal(s.calls[0].url, "https://api.stripe.com/v1/balance?expand[0]=available")
  assert.equal(s.calls[0].headers.Authorization, `Bearer ${READ_KEY}`)
  assert.equal(s.calls[0].headers["Stripe-Version"], "2024-04-10")
  assert.ok(!s.calls[0].url.includes(READ_KEY), "the key never goes into a URL")
})

test("paths are a short list: anything else is refused before a request", async () => {
  const s = scripted([])
  await assert.rejects(client(s.fetch).get("/payment_intents/pi_1/../../charges"), (e: unknown) => e instanceof StripeApiError && e.kind === "invalid")
  await assert.rejects(client(s.fetch).get("https://evil.example/v1/balance"), StripeApiError)
  assert.equal(s.calls.length, 0)
})

test("no key, or a publishable one, never reaches Stripe", async () => {
  const s = scripted([])
  await assert.rejects(new StripeReadClient({ apiKey: "", fetch: s.fetch }).get("/balance"), (e: unknown) => e instanceof StripeApiError && e.kind === "auth")
  await assert.rejects(new StripeReadClient({ apiKey: "pk_live_TESTONLYabcdefghijkl", fetch: s.fetch }).get("/balance"), (e: unknown) => e instanceof StripeApiError && e.kind === "auth" && /publishable/.test(e.message))
  assert.equal(s.calls.length, 0)
})

test("429 waits for Retry-After and tries again; 5xx backs off; Stripe-Should-Retry false stops at once", async () => {
  const clock = fakeClock()
  const s = scripted([response(429, { error: { message: "Too many" } }, { "Retry-After": "2" }), response(503, "oops"), response(200, { ok: true })])
  assert.deepEqual(await client(s.fetch, clock).get("/balance"), { ok: true })
  assert.equal(s.calls.length, 3)
  assert.deepEqual(clock.slept.filter((ms) => ms >= 100), [2000, 750])

  const stop = scripted([response(500, { error: { message: "No" } }, { "Stripe-Should-Retry": "false" })])
  await assert.rejects(client(stop.fetch).get("/balance"), (e: unknown) => e instanceof StripeApiError && e.kind === "stripe" && e.status === 500)
  assert.equal(stop.calls.length, 1)
})

test("a dropped connection is retried twice, then reported as a network error", async () => {
  const s = scripted([new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")])
  await assert.rejects(client(s.fetch).get("/balance"), (e: unknown) => e instanceof StripeApiError && e.kind === "network")
  assert.equal(s.calls.length, 3)
})

test("errors are typed and masked: 401 auth, 403 with the permission Stripe names, 404 not found", async () => {
  const forbidden = scripted([
    response(403, { error: { type: "invalid_request_error", message: `The provided key '${READ_KEY.slice(0, 12)}*****' does not have the required permissions for this endpoint on account 'acct_Fixture'. Having the 'rak_payout_read' permission would allow this request to continue.` } }, { "Request-Id": "req_Fixture" }),
  ])
  await assert.rejects(client(forbidden.fetch).get("/payouts"), (e: unknown) => {
    assert.ok(e instanceof StripeApiError)
    assert.equal(e.kind, "permission")
    assert.equal(e.permission, "rak_payout_read")
    assert.equal(e.requestId, "req_Fixture")
    assert.ok(!e.message.includes(READ_KEY.slice(0, 16)), e.message)
    return true
  })
  const auth = scripted([response(401, { error: { message: `Invalid API Key provided: ${READ_KEY}` } })])
  await assert.rejects(client(auth.fetch).get("/balance"), (e: unknown) => e instanceof StripeApiError && e.kind === "auth" && !e.message.includes(READ_KEY))
  const missing = scripted([response(404, { error: { message: "No such payment_intent: 'pi_Fixture'", code: "resource_missing" } })])
  await assert.rejects(client(missing.fetch).get("/payment_intents/pi_Fixture"), (e: unknown) => e instanceof StripeApiError && e.kind === "not_found" && e.code === "resource_missing")
  const notJson = scripted([response(200, "<html>")])
  await assert.rejects(client(notJson.fetch).get("/balance"), (e: unknown) => e instanceof StripeApiError && e.kind === "stripe")
})

test("lists follow starting_after page by page and stop at maxPages", async () => {
  const page = (ids: string[], hasMore: boolean) => response(200, { object: "list", data: ids.map((id) => ({ id })), has_more: hasMore })
  const s = scripted([page(["pi_a", "pi_b"], true), page(["pi_c"], true), page(["pi_d"], false)])
  const all = await client(s.fetch).list<{ id: string }>("/payment_intents", { created: { gte: 1 } }, { maxPages: 5, limit: 2 })
  assert.deepEqual(all.data.map((x) => x.id), ["pi_a", "pi_b", "pi_c", "pi_d"])
  assert.equal(all.complete, true)
  assert.equal(all.pages, 3)
  assert.match(s.calls[1].url, /starting_after=pi_b/)
  assert.match(s.calls[0].url, /limit=2/)

  const capped = scripted([page(["pi_a"], true), page(["pi_b"], true)])
  const some = await client(capped.fetch).list<{ id: string }>("/payment_intents", {}, { maxPages: 2 })
  assert.equal(some.complete, false)
  assert.equal(capped.calls.length, 2)
})

test("the token bucket keeps the pace and the backoff grows", async () => {
  const clock = fakeClock()
  const bucket = new TokenBucket(2, clock)
  await bucket.take()
  await bucket.take()
  assert.deepEqual(clock.slept, [])
  await bucket.take()
  assert.deepEqual(clock.slept, [500])
  assert.equal(backoffMs(0, () => 1), 500)
  assert.equal(backoffMs(2, () => 1), 2000)
  assert.equal(backoffMs(10, () => 1), 8000)
  assert.equal(retryAfterMs("3", 0), 3000)
  assert.equal(retryAfterMs(null, 0), null)
  assert.equal(retryAfterMs("Wed, 07 Oct 2026 12:00:10 GMT", Date.parse("2026-10-07T12:00:00Z")), 10_000)
})
