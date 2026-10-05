import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { BridgeError, HttpBridgeClient, classifyHttpError, describeError } from "../src/modules/subiekt/lib/bridge-client.ts"
import { verifySignature } from "../src/modules/subiekt/lib/signature.ts"
import type { ContractOrder } from "../src/modules/subiekt/lib/contract.ts"

const SECRET = "test-secret-0123456789abcdef"
const order = JSON.parse(readFileSync(new URL("../contract/examples/order-create.request.json", import.meta.url), "utf8")) as ContractOrder
const created = JSON.parse(readFileSync(new URL("../contract/examples/order-create.response.json", import.meta.url), "utf8"))
const unmatched = JSON.parse(readFileSync(new URL("../contract/examples/error.unmatched-lines.json", import.meta.url), "utf8"))

interface Call {
  url: URL
  method: string
  headers: Record<string, string>
  body: string
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: (init?.body as string) ?? "",
    }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof HttpBridgeClient>[0]> = {}) {
  return new HttpBridgeClient({ baseUrl: "https://bridge.example.com/", secret: SECRET, timeoutMs: 2000, contractVersion: "1.0.0", fetch: fetchImpl, now: () => 1_791_105_306, ...extra })
}

test("every request is signed over method, path with query and the exact body", async () => {
  const calls: Call[] = []
  const c = client(fakeFetch((call) => (call.url.pathname === "/v1/orders" ? json(201, created) : json(200, { events: [], last_id: 7, has_more: false })), calls))

  const res = await c.createOrder(order)
  assert.equal(res.created, true)
  await c.listEvents(7, 50)

  for (const call of calls) {
    const verdict = verifySignature({
      header: call.headers["X-Koda-Signature"],
      secrets: [SECRET],
      method: call.method,
      pathAndQuery: `${call.url.pathname}${call.url.search}`,
      body: call.body,
      nowSeconds: 1_791_105_306,
    })
    assert.deepEqual(verdict, { ok: true }, `${call.method} ${call.url}`)
    assert.equal(call.headers["X-Koda-Contract"], "1.0.0")
  }
  assert.equal(calls[1].url.search, "?after=7&limit=50")
  assert.deepEqual(JSON.parse(calls[0].body), order)
})

test("Cloudflare Access headers go only when both parts are set", async () => {
  const calls: Call[] = []
  await client(fakeFetch(() => json(200, { status: "ok" }), calls), { cfAccessClientId: "id.access", cfAccessClientSecret: "s3cr3t" }).health()
  await client(fakeFetch(() => json(200, { status: "ok" }), calls), { cfAccessClientId: "id.access" }).health()
  assert.equal(calls[0].headers["CF-Access-Client-Id"], "id.access")
  assert.equal(calls[0].headers["CF-Access-Client-Secret"], "s3cr3t")
  assert.equal(calls[1].headers["CF-Access-Client-Id"], undefined)
})

test("an existing ZK comes back as created: false", async () => {
  const res = await client(fakeFetch(() => json(200, { ...created, created: undefined }))).createOrder(order)
  assert.equal(res.created, false)
  assert.equal(res.document.number, "ZK 128/MAG/2026")
})

test("a contract error keeps its code and its retry flag", async () => {
  await assert.rejects(client(fakeFetch(() => json(422, unmatched))).createOrder(order), (err: unknown) => {
    assert.ok(err instanceof BridgeError)
    assert.equal(err.code, "unmatched_lines")
    assert.equal(err.retryable, false)
    assert.equal((err.details?.lines as unknown[]).length, 1)
    return true
  })
})

test("a proxy page in front of a dead bridge is retryable", async () => {
  const html = () => new Response("<html><body>502 Bad gateway</body></html>", { status: 502, headers: { "Content-Type": "text/html" } })
  await assert.rejects(client(fakeFetch(html)).health(), (err: unknown) => err instanceof BridgeError && err.code === "bridge_unavailable" && err.retryable)
})

test("network failures and timeouts are retryable, signatures are not", async () => {
  const refused = fakeFetch(() => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" } })
  })
  await assert.rejects(client(refused).health(), (err: unknown) => err instanceof BridgeError && err.code === "bridge_unreachable" && err.retryable && err.status === 0)

  const slow = fakeFetch(() => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
  })
  await assert.rejects(client(slow).health(), (err: unknown) => err instanceof BridgeError && err.code === "timeout" && err.retryable)

  await assert.rejects(client(fakeFetch(() => new Response("", { status: 401 }))).health(), (err: unknown) => err instanceof BridgeError && err.code === "invalid_signature" && !err.retryable)
})

test("an unknown order is null, not an error", async () => {
  const res = await client(fakeFetch(() => json(404, { error: { code: "order_not_found", message: "x", retryable: false } }))).getOrder("order_x")
  assert.equal(res, null)
})

test("5xx with a contract body is retryable even if the body says otherwise", () => {
  const err = classifyHttpError(503, { error: { code: "subiekt_unavailable", message: "Sfera is starting", retryable: false } }, "")
  assert.equal(err.retryable, true)
  assert.equal(err.code, "subiekt_unavailable")
})

test("plain errors are described safely", () => {
  assert.deepEqual(describeError(new Error("boom")), { code: "internal", message: "boom", retryable: true })
  assert.deepEqual(describeError(Object.assign(new Error("bad data"), { code: "no_lines", retryable: false })), {
    code: "no_lines",
    message: "bad data",
    retryable: false,
  })
})
