import { test } from "node:test"
import assert from "node:assert/strict"
import { BASELINKER_API_URL, BaseLinkerClient } from "../src/modules/baselinker/lib/client.ts"
import { BaseLinkerApiError, BaseLinkerUnknownResultError, describeError, interpretResponse } from "../src/modules/baselinker/lib/errors.ts"
import { BaseLinkerWriteBlockedError } from "../src/modules/baselinker/lib/security.ts"

const TOKEN = "5012345-5067890-QWERTYUIOPASDFGHJKLZXCVBNM1234567890ABCDEFGHIJKLMNOP"
const mask = (t: string) => t.split(TOKEN).join("***")

interface Call {
  url: string
  method: string
  params: Record<string, unknown>
  token: string | null
}

/** A scripted connector.php: one answer (or thrown error) per call, in order. */
function fakeBaseLinker(script: Array<(call: Call) => Response | Error>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""))
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: Call = { url: String(url), method: body.get("method") ?? "", params: JSON.parse(body.get("parameters") ?? "{}"), token: headers["X-BLToken"] ?? null }
    calls.push(call)
    const step = script[Math.min(calls.length - 1, script.length - 1)]
    const result = step(call)
    if (result instanceof Error) throw result
    return result
  }) as typeof fetch
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function client(fetchImpl: typeof fetch, exportOrders = true) {
  const sleeps: number[] = []
  const c = new BaseLinkerClient({
    token: TOKEN,
    exportOrders,
    requestsPerMinute: 100,
    timeoutMs: 1000,
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    limiter: null,
  })
  return { c, sleeps }
}

test("response: an error in the body of an HTTP 200 is an error, transient by code", () => {
  assert.throws(
    () => interpretResponse({ method: "getOrders", httpStatus: 200, text: JSON.stringify({ status: "ERROR", error_code: "ERROR_BAD_TOKEN", error_message: "bad" }), mask }),
    (err: unknown) => err instanceof BaseLinkerApiError && err.code === "ERROR_BAD_TOKEN" && err.transient === false,
  )
  assert.throws(
    () => interpretResponse({ method: "getOrders", httpStatus: 200, text: JSON.stringify({ status: "ERROR", error_code: "ERROR_RATE_LIMIT" }), mask }),
    (err: unknown) => err instanceof BaseLinkerApiError && err.transient === true,
  )
  assert.deepEqual(interpretResponse({ method: "getOrders", httpStatus: 200, text: '{"status":"SUCCESS","orders":[]}', mask }), { status: "SUCCESS", orders: [] })
})

test("response: an HTML 502 from a gateway and broken JSON are transient, with the token masked", () => {
  assert.throws(
    () => interpretResponse({ method: "getOrders", httpStatus: 502, text: `<html>Bad gateway ${TOKEN}</html>`, mask }),
    (err: unknown) => err instanceof BaseLinkerApiError && err.code === "HTTP_502" && err.transient && !err.message.includes(TOKEN),
  )
  assert.throws(
    () => interpretResponse({ method: "getOrders", httpStatus: 200, text: "<html>maintenance</html>", mask }),
    (err: unknown) => err instanceof BaseLinkerApiError && err.code === "ERROR_JSON" && err.transient,
  )
  assert.throws(
    () => interpretResponse({ method: "getOrders", httpStatus: 400, text: "{}", mask }),
    (err: unknown) => err instanceof BaseLinkerApiError && err.code === "HTTP_400" && !err.transient,
  )
})

test("client: the call shape is BaseLinker's contract (POST, X-BLToken, method and JSON parameters)", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([json({ status: "SUCCESS", statuses: [{ id: 7, name: "Nowe" }] })])
  const { c } = client(fetchImpl)
  const statuses = await c.getOrderStatusList()
  assert.equal(statuses.get(7), "Nowe")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, BASELINKER_API_URL)
  assert.equal(calls[0].method, "getOrderStatusList")
  assert.equal(calls[0].token, TOKEN)
})

test("client: a blocked write never reaches fetch", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([json({ status: "SUCCESS" })])
  const { c } = client(fetchImpl)
  await assert.rejects(c.call("updateInventoryProductsStock", { inventory_id: 1, products: {} }), BaseLinkerWriteBlockedError)
  await assert.rejects(c.call("setOrderStatus", { order_id: 1, status_id: 2 }), BaseLinkerWriteBlockedError)
  await assert.rejects(c.call("addOrder", {}), BaseLinkerWriteBlockedError)
  assert.equal(calls.length, 0)
})

test("client: reads retry transient failures with growing pauses", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([
    () => new Response("<html>502</html>", { status: 502 }),
    () => new TypeError("fetch failed"),
    json({ status: "SUCCESS", inventories: [{ inventory_id: 31, name: "Main", warehouses: ["bl_12"], default_warehouse: "bl_12" }] }),
  ])
  const { c, sleeps } = client(fetchImpl)
  const inventories = await c.getInventories()
  assert.equal(calls.length, 3)
  assert.deepEqual(sleeps, [1000, 4000])
  assert.deepEqual(inventories, [{ id: 31, name: "Main", warehouses: ["bl_12"], defaultWarehouse: "bl_12" }])
})

test("client: permanent errors are thrown at once, without retries", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([json({ status: "ERROR", error_code: "ERROR_BAD_PARAMETERS", error_message: "no" })])
  const { c } = client(fetchImpl)
  await assert.rejects(c.getOrders({}), (err: unknown) => err instanceof BaseLinkerApiError && err.code === "ERROR_BAD_PARAMETERS")
  assert.equal(calls.length, 1)
})

test("client: a token echoed by BaseLinker never reaches the error message", async () => {
  const { fetchImpl } = fakeBaseLinker([json({ status: "ERROR", error_code: "ERROR_BAD_TOKEN", error_message: `Invalid token ${TOKEN}` })])
  const { c } = client(fetchImpl)
  await assert.rejects(c.getOrders({}), (err: unknown) => err instanceof Error && !err.message.includes(TOKEN) && !err.message.includes("QWERTY"))
})

const emptyScan = json({ status: "SUCCESS", orders: [] })

test("addOrder: one shot; a timeout becomes an unknown result after a second scan", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([
    emptyScan,
    () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    emptyScan,
  ])
  const { c } = client(fetchImpl)
  await assert.rejects(c.createOrderOnce({ products: [] } as never, "[medusa:order_1]", 1_790_000_000), BaseLinkerUnknownResultError)
  assert.deepEqual(
    calls.map((x) => x.method),
    ["getOrders", "addOrder", "getOrders"],
  )
  assert.equal(describeError(new BaseLinkerUnknownResultError("addOrder", "x")).retryable, true)
})

test("addOrder: a rate limit refusal is the one failure that may repeat at once", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([
    emptyScan,
    json({ status: "ERROR", error_code: "ERROR_RATE_LIMIT", error_message: "slow down" }),
    json({ status: "SUCCESS", order_id: 9123 }),
  ])
  const { c } = client(fetchImpl)
  const res = await c.createOrderOnce({ products: [] } as never, "[medusa:order_1]", 1_790_000_000)
  assert.deepEqual(res, { blOrderId: "9123", adopted: false })
  assert.deepEqual(
    calls.map((x) => x.method),
    ["getOrders", "addOrder", "addOrder"],
  )
})

test("addOrder: blocked by the barrier when export is off, after a read-only scan", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([emptyScan])
  const { c } = client(fetchImpl, false)
  await assert.rejects(c.createOrderOnce({ products: [] } as never, "[medusa:order_1]", 1_790_000_000), BaseLinkerWriteBlockedError)
  assert.deepEqual(
    calls.map((x) => x.method),
    ["getOrders"],
  )
})
