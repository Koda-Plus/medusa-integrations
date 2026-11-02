/**
 * The wire of the seller API, with a fake fetch, a fake clock and a fake
 * sleep: the access token is asked with HTTP Basic client authentication
 * and the client credentials grant, kept until shortly before it runs out
 * and shared by requests running at the same time; a 401 asks for a fresh
 * token and tries once more; a 429 waits Retry-After (at most 30 seconds,
 * at most twice); reads are retried after a 5xx or a network error with a
 * growing wait, writes never; the rate limit headers are kept and an
 * exhausted limit waits for its reset; errors name the fields and never
 * carry a secret; the body's media type can be overridden.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHttp, isApiError, MarketplaceApiError, problemOf, queryString, retryAfterMs, SCOPES, type HttpConfig } from "../src/modules/vonhalsky/lib/http.ts"

const TOKEN_URL = "https://auth.example.com/oauth2/token"
const API_URL = "https://api.example.com/inpsa"
const CLIENT_ID = "client-test-1"
const CLIENT_SECRET = "secret-abcdefgh"

type Seen = { url: string; method: string; headers: Headers; body: string | null }

const json = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

const tokenAnswer = (value: string, expiresIn: number | null = 300): Response => json(200, { access_token: value, token_type: "Bearer", ...(expiresIn === null ? {} : { expires_in: expiresIn }) })

/**
 * A wire with a scripted API: the token endpoint hands out "token-1",
 * "token-2"... and every API request takes the next answer of `api`
 * (the last one repeats). A function answer may throw, like a network error.
 */
function wire(api: Array<Response | (() => Response)>, over: Partial<HttpConfig> = {}) {
  const seen: Seen[] = []
  const sleeps: number[] = []
  let clock = Date.parse("2026-10-18T10:00:00Z")
  let tokens = 0
  let calls = 0
  const fetchFake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const s: Seen = { url: String(input), method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : null }
    seen.push(s)
    if (s.url === TOKEN_URL) return tokenAnswer(`token-${++tokens}`)
    const next = api[Math.min(calls, api.length - 1)]
    calls += 1
    return typeof next === "function" ? next() : next.clone()
  }) as typeof fetch
  const http = createHttp({
    apiUrl: API_URL,
    tokenUrl: TOKEN_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    organizationId: "org 1",
    timeoutMs: 5000,
    fetch: fetchFake,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
    ...over,
  })
  return {
    http,
    seen,
    sleeps,
    tokenCalls: () => seen.filter((s) => s.url === TOKEN_URL),
    apiCalls: () => seen.filter((s) => s.url !== TOKEN_URL),
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  }
}

const rejectsWith = async (p: Promise<unknown>, check: (e: MarketplaceApiError) => void): Promise<void> => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(isApiError(e), `expected a MarketplaceApiError, got ${String(e)}`)
    check(e)
    return true
  })
}

test("token: asked with HTTP Basic client authentication and the client credentials grant", async () => {
  const w = wire([json(200, { ok: true })])
  assert.deepEqual(await w.http.request("GET", "/v1/organizations"), { ok: true })
  const [t] = w.tokenCalls()
  assert.equal(t.method, "POST")
  assert.equal(t.headers.get("Authorization"), `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`)
  assert.equal(t.headers.get("Content-Type"), "application/x-www-form-urlencoded")
  const form = new URLSearchParams(t.body ?? "")
  assert.equal(form.get("grant_type"), "client_credentials")
  assert.equal(form.get("scope"), SCOPES)
  assert.ok(!(t.body ?? "").includes(CLIENT_SECRET), "the secret travels only in the Basic header")
})

test("token: every API request carries the bearer token, JSON and the Polish language", async () => {
  const w = wire([json(200, {})])
  await w.http.request("GET", "/v1/categories", { query: { depth: 3 } })
  const [call] = w.apiCalls()
  assert.equal(call.url, `${API_URL}/v1/categories?depth=3`)
  assert.equal(call.headers.get("Authorization"), "Bearer token-1")
  assert.equal(call.headers.get("Accept"), "application/json")
  assert.equal(call.headers.get("Accept-Language"), "pl")
  const en = wire([json(200, {})], { language: "en" })
  await en.http.request("GET", "/v1/categories")
  assert.equal(en.apiCalls()[0].headers.get("Accept-Language"), "en")
})

test("token: kept and reused until shortly before it runs out, then asked again", async () => {
  const w = wire([json(200, {})])
  await w.http.request("GET", "/a")
  w.advance(4 * 60 * 1000)
  await w.http.request("GET", "/b")
  assert.equal(w.tokenCalls().length, 1, "reused within its life")
  w.advance(31 * 1000)
  await w.http.request("GET", "/c")
  assert.equal(w.tokenCalls().length, 2, "renewed 30 seconds before it runs out")
  assert.equal(w.apiCalls()[2].headers.get("Authorization"), "Bearer token-2")
})

test("token: requests running at the same time share one token request", async () => {
  const w = wire([json(200, {})])
  await Promise.all([w.http.request("GET", "/a"), w.http.request("GET", "/b"), w.http.request("GET", "/c")])
  assert.equal(w.tokenCalls().length, 1)
  assert.equal(w.apiCalls().length, 3)
})

test("token: refused credentials are an error that names what to check and never the secret", async () => {
  const seen: string[] = []
  const http = createHttp({
    apiUrl: API_URL,
    tokenUrl: TOKEN_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    organizationId: "org-1",
    timeoutMs: 5000,
    fetch: (async (input: string | URL | Request) => {
      seen.push(String(input))
      return json(401, { error: "invalid_client", error_description: `client ${CLIENT_ID} with secret ${CLIENT_SECRET} is unknown` })
    }) as typeof fetch,
    sleep: async () => {},
  })
  await rejectsWith(http.request("GET", "/v1/organizations"), (e) => {
    assert.equal(e.status, 401)
    assert.equal(e.code, "TOKEN")
    assert.match(e.message, /clientId, clientSecret/)
    assert.ok(!e.message.includes(CLIENT_SECRET))
    assert.ok(!e.message.includes(CLIENT_ID))
  })
  assert.deepEqual(seen, [TOKEN_URL], "no API request without a token")
})

test("401: the token is dropped, a fresh one is asked and the request is tried once more", async () => {
  const w = wire([json(401, { errorCode: "UNAUTHORIZED" }), json(200, { ok: true })])
  assert.deepEqual(await w.http.request("GET", "/v1/organizations"), { ok: true })
  assert.equal(w.tokenCalls().length, 2)
  assert.deepEqual(
    w.apiCalls().map((c) => c.headers.get("Authorization")),
    ["Bearer token-1", "Bearer token-2"],
  )
})

test("401: a second refusal is an error, not a loop", async () => {
  const w = wire([json(401, { errorCode: "UNAUTHORIZED", errorMessage: "Token rejected" })])
  await rejectsWith(w.http.request("GET", "/v1/organizations"), (e) => {
    assert.equal(e.status, 401)
    assert.equal(e.code, "UNAUTHORIZED")
  })
  assert.equal(w.apiCalls().length, 2)
  assert.equal(w.tokenCalls().length, 2)
})

test("429: waits Retry-After in seconds and tries again", async () => {
  const w = wire([json(429, {}, { "Retry-After": "2" }), json(200, { ok: true })])
  assert.deepEqual(await w.http.request("POST", "/v1/x", { body: {} }), { ok: true }, "a 429 was not done, so even a write is sent again")
  assert.deepEqual(w.sleeps, [2000])
  assert.equal(w.apiCalls().length, 2)
})

test("429: Retry-After as an HTTP date waits until that moment", async () => {
  const at = new Date(Date.parse("2026-10-18T10:00:05Z")).toUTCString()
  const w = wire([json(429, {}, { "Retry-After": at }), json(200, {})])
  await w.http.request("GET", "/v1/x")
  assert.deepEqual(w.sleeps, [5000])
})

test("429: without Retry-After the wait grows, and the third refusal is an error", async () => {
  const w = wire([json(429, { errorMessage: "Slow down" })])
  await rejectsWith(w.http.request("GET", "/v1/x"), (e) => {
    assert.equal(e.status, 429)
    assert.equal(e.code, "RATE_LIMIT")
  })
  assert.deepEqual(w.sleeps, [1000, 2000])
  assert.equal(w.apiCalls().length, 3)
})

test("429: a wait longer than 30 seconds is an error the caller reports, nothing sleeps", async () => {
  const w = wire([json(429, {}, { "Retry-After": "120" })])
  await rejectsWith(w.http.request("GET", "/v1/x"), (e) => {
    assert.equal(e.status, 429)
    assert.match(e.message, /120 s/)
  })
  assert.deepEqual(w.sleeps, [])
  assert.equal(w.apiCalls().length, 1)
})

test("5xx: a read is retried with a growing wait", async () => {
  const w = wire([json(503, {}), json(502, {}), json(200, { ok: true })])
  assert.deepEqual(await w.http.request("GET", "/v1/x"), { ok: true })
  assert.deepEqual(w.sleeps, [500, 1000])
  const gaveUp = wire([json(500, { errorMessage: "Boom" })])
  await rejectsWith(gaveUp.http.request("GET", "/v1/x"), (e) => assert.equal(e.status, 500))
  assert.equal(gaveUp.apiCalls().length, 3)
})

test("5xx: a write is never sent twice", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
    const w = wire([json(503, {}), json(200, {})])
    await rejectsWith(w.http.request(method, "/v1/x", { body: {} }), (e) => assert.equal(e.status, 503))
    assert.equal(w.apiCalls().length, 1, method)
    assert.deepEqual(w.sleeps, [])
  }
})

test("network: a read is retried after a network error, a write is not", async () => {
  const down = () => {
    throw new TypeError("fetch failed")
  }
  const read = wire([down, json(200, { ok: true })])
  assert.deepEqual(await read.http.request("GET", "/v1/x"), { ok: true })
  assert.deepEqual(read.sleeps, [500])
  const write = wire([down, json(200, {})])
  await rejectsWith(write.http.request("POST", "/v1/x", { body: {} }), (e) => {
    assert.equal(e.status, 0)
    assert.equal(e.code, "NETWORK")
    assert.match(e.message, /could not be reached/)
  })
  assert.equal(write.apiCalls().length, 1)
})

test("limits: the rate limit headers of the last answer are kept, the reset in epoch seconds", async () => {
  const reset = Math.floor(Date.parse("2026-10-18T10:01:00Z") / 1000)
  const w = wire([json(200, {}, { "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "42", "X-RateLimit-Reset": String(reset) })])
  assert.deepEqual(w.http.limits(), { limit: null, remaining: null, resetAt: null })
  await w.http.request("GET", "/v1/x")
  assert.deepEqual(w.http.limits(), { limit: 100, remaining: 42, resetAt: reset * 1000 })
})

test("limits: an exhausted limit waits for its reset before the next request, at most 30 seconds", async () => {
  const soon = Math.floor(Date.parse("2026-10-18T10:00:10Z") / 1000)
  const w = wire([json(200, {}, { "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(soon) }), json(200, {}, { "X-RateLimit-Remaining": "99" })])
  await w.http.request("GET", "/v1/a")
  assert.deepEqual(w.sleeps, [])
  await w.http.request("GET", "/v1/b")
  assert.deepEqual(w.sleeps, [10_000])
  const late = Math.floor(Date.parse("2026-10-18T10:05:00Z") / 1000)
  const far = wire([json(200, {}, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(late) }), json(200, {})])
  await far.http.request("GET", "/v1/a")
  await far.http.request("GET", "/v1/b")
  assert.deepEqual(far.sleeps, [30_000])
})

test("errors: problem+json becomes an error that names the fields", async () => {
  const w = wire([json(400, { errorCode: "VALIDATION_ERROR", errorMessage: "Invalid offer", details: [{ field: "product.name", detail: "must not be blank" }, { detail: "images are required" }, "junk"] })])
  await rejectsWith(w.http.request("POST", "/v1/offers/batch", { body: [] }), (e) => {
    assert.equal(e.status, 400)
    assert.equal(e.code, "VALIDATION_ERROR")
    assert.equal(e.message, "InPost Von Halsky answered 400 VALIDATION_ERROR: Invalid offer: product.name must not be blank; images are required")
    assert.deepEqual(e.details, [
      { field: "product.name", detail: "must not be blank" },
      { field: null, detail: "images are required" },
    ])
  })
})

test("errors: secrets and tokens never reach the message", async () => {
  const w = wire([json(400, { errorMessage: `Bad request from ${CLIENT_ID} using ${CLIENT_SECRET} and Bearer token-1` })])
  await rejectsWith(w.http.request("GET", "/v1/x"), (e) => {
    assert.ok(!e.message.includes(CLIENT_SECRET))
    assert.ok(!e.message.includes(CLIENT_ID))
    assert.ok(!e.message.includes("token-1"))
    assert.match(e.message, /Bearer \*\*\*/)
  })
  const text = wire([new Response("<html>Gateway says no</html>", { status: 403 })])
  await rejectsWith(text.http.request("GET", "/v1/x"), (e) => {
    assert.equal(e.code, "HTTP_403")
    assert.match(e.message, /Gateway says no/)
  })
})

test("body: JSON by default, the override reaches the header, no body sends no media type", async () => {
  const w = wire([json(200, {})])
  await w.http.request("PATCH", "/v1/organizations/org-1/offers/off-1", { body: { stock: { quantity: 1 } }, contentType: "application/merge-patch+json" })
  await w.http.request("POST", "/v1/organizations/org-1/offers/batch", { body: [{ externalId: "variant_1" }] })
  await w.http.request("POST", "/v1/organizations/org-1/offers/off-1/close")
  const [patch, post, close] = w.apiCalls()
  assert.equal(patch.headers.get("Content-Type"), "application/merge-patch+json")
  assert.equal(patch.body, JSON.stringify({ stock: { quantity: 1 } }))
  assert.equal(post.headers.get("Content-Type"), "application/json")
  assert.equal(close.headers.get("Content-Type"), null)
  assert.equal(close.body, null)
})

test("answers: no content and a gone resource read as null, a 404 otherwise is an error", async () => {
  assert.equal(await wire([new Response(null, { status: 204 })]).http.request("DELETE", "/v1/x"), null)
  assert.equal(await wire([json(404, { errorCode: "NOT_FOUND" })]).http.request("GET", "/v1/x", { notFound: "null" }), null)
  await rejectsWith(wire([json(404, { errorCode: "NOT_FOUND" })]).http.request("GET", "/v1/x"), (e) => assert.equal(e.code, "NOT_FOUND"))
})

test("paths: the organization is filled in, encoded", () => {
  const w = wire([json(200, {})])
  assert.equal(w.http.org("/v1/organizations/{org}/offers"), "/v1/organizations/org%201/offers")
})

test("query: arrays repeat their key, empty values are left out", () => {
  assert.equal(queryString({ offerStatus: ["PUBLISHED", "SOLDOUT"], limit: 30, untilId: null, q: "", x: undefined, flag: true }), "?offerStatus=PUBLISHED&offerStatus=SOLDOUT&limit=30&flag=true")
  assert.equal(queryString({ name: "kubek & talerz" }), "?name=kubek%20%26%20talerz")
  assert.equal(queryString(undefined), "")
  assert.equal(queryString({ a: null }), "")
})

test("Retry-After: seconds or an HTTP date, null when unreadable", () => {
  const now = Date.parse("2026-10-18T10:00:00Z")
  assert.equal(retryAfterMs("3", now), 3000)
  assert.equal(retryAfterMs("1.5", now), 1500)
  assert.equal(retryAfterMs(new Date(now + 7000).toUTCString(), now), 7000)
  assert.equal(retryAfterMs(new Date(now - 7000).toUTCString(), now), 0, "a date in the past waits nothing")
  assert.equal(retryAfterMs("soon", now), null)
  assert.equal(retryAfterMs(null, now), null)
})

test("problem: a status without a body still gets a code", () => {
  assert.equal(problemOf(429, null, "Too many").code, "RATE_LIMIT")
  assert.equal(problemOf(502, "not json", "Bad gateway").code, "HTTP_502")
  assert.equal(problemOf(502, null, "Bad gateway").message, "InPost Von Halsky answered 502 HTTP_502: Bad gateway")
})
