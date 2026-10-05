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

/* ---- 0.2 ------------------------------------------------------------ */

test("writes need the permit of their writer: forWriter adds one, call() never writes", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([json({ status: "SUCCESS", counter: 1, warnings: { "12": "Bundle stock cannot be set" } })])
  const { c } = client(fetchImpl)
  await assert.rejects(c.updateInventoryProductsStock(1, { "11": { bl_1: 2 } }), BaseLinkerWriteBlockedError)
  await assert.rejects(c.forWriter("prices").updateInventoryProductsStock(1, { "11": { bl_1: 2 } }), BaseLinkerWriteBlockedError)
  await assert.rejects(c.forWriter("stockToBaseLinker").call("updateInventoryProductsStock", {}), BaseLinkerWriteBlockedError)
  assert.equal(calls.length, 0)
  const res = await c.forWriter("stockToBaseLinker").updateInventoryProductsStock(1, { "11": { bl_1: 2 }, "12": { bl_1: 1 } })
  assert.deepEqual(res, { counter: 1, warnings: { "12": "Bundle stock cannot be set" } })
  assert.deepEqual(calls[0].params, { inventory_id: 1, products: { "11": { bl_1: 2 }, "12": { bl_1: 1 } } })
})

test("a card is created at most once: a SKU already there is adopted, an unclear answer is settled by a second lookup", async () => {
  const lookupEmpty = json({ status: "SUCCESS", products: {} })
  const found = json({ status: "SUCCESS", products: { "701": { id: 701, sku: "op-1 ", name: "Opona" } } })
  {
    const { calls, fetchImpl } = fakeBaseLinker([found])
    const { c } = client(fetchImpl)
    const res = await c.forWriter("cards").createCardOnce(9, { inventory_id: 9, sku: "OP-1" }, "OP-1", null)
    assert.deepEqual(res, { productId: "701", adopted: true })
    assert.deepEqual(
      calls.map((x) => x.method),
      ["getInventoryProductsList"],
    )
    assert.equal(calls[0].params.filter_sku, "OP-1")
  }
  {
    const { calls, fetchImpl } = fakeBaseLinker([lookupEmpty, () => new TypeError("fetch failed"), found])
    const { c, sleeps } = client(fetchImpl)
    const res = await c.forWriter("cards").createCardOnce(9, { inventory_id: 9, sku: "OP-1" }, "OP-1", null)
    assert.deepEqual(res, { productId: "701", adopted: true })
    assert.deepEqual(
      calls.map((x) => x.method),
      ["getInventoryProductsList", "addInventoryProduct", "getInventoryProductsList"],
      "never a second addInventoryProduct",
    )
    assert.deepEqual(sleeps, [3000])
  }
  {
    const two = json({ status: "SUCCESS", products: { "1": { id: 1, sku: "OP-1" }, "2": { id: 2, sku: "op-1" } } })
    const { calls, fetchImpl } = fakeBaseLinker([two])
    const { c } = client(fetchImpl)
    await assert.rejects(c.forWriter("cards").createCardOnce(9, {}, "OP-1", null), (err: unknown) => err instanceof BaseLinkerApiError && err.code === "DUPLICATE_SKU")
    assert.equal(calls.length, 1)
  }
})

test("the invoice number goes into one order field and nothing else", async () => {
  const { calls, fetchImpl } = fakeBaseLinker([json({ status: "SUCCESS" })])
  const { c } = client(fetchImpl)
  const w = c.forWriter("invoiceNumbers")
  await w.setOrderField(55, "extra_field_1", "FV 12/10/2026")
  await w.setOrderField(55, "custom:135", "FV 13/10/2026")
  assert.deepEqual(calls[0].params, { order_id: 55, extra_field_1: "FV 12/10/2026" })
  assert.deepEqual(calls[1].params, { order_id: 55, custom_extra_fields: { "135": "FV 13/10/2026" } })
  await assert.rejects(w.setOrderField(55, "admin_comments", "x"), BaseLinkerWriteBlockedError)
})

test("reads of 0.2: variants in the list, details in batches of 100, sources and price groups parsed", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => String(i + 1))
  const { calls, fetchImpl } = fakeBaseLinker([
    json({ status: "SUCCESS", products: {} }),
    json({ status: "SUCCESS", products: {} }),
    json({ status: "SUCCESS", sources: { personal: { "0": "Telefon" }, allegro: { "1455": "koda" }, order_return: ["Zwrot"] } }),
    json({ status: "SUCCESS", price_groups: [{ price_group_id: 105, name: "Detal", currency: "pln", is_default: true, source_price_group_id: 0 }] }),
  ])
  const { c } = client(fetchImpl)
  await c.getInventoryProductsData(9, ids)
  assert.equal((calls[0].params.products as number[]).length, 100)
  assert.equal((calls[1].params.products as number[]).length, 50)
  assert.deepEqual(await c.getOrderSources(), [
    { type: "allegro", id: 1455, name: "koda" },
    { type: "personal", id: 0, name: "Telefon" },
  ])
  assert.deepEqual(await c.getInventoryPriceGroups(), [{ id: 105, name: "Detal", currency: "PLN", isDefault: true, derived: false }])
})
