import { test } from "node:test"
import assert from "node:assert/strict"
import { CeneoApiError, CeneoBlockedError, CeneoClient, isReadPath, maskSecrets, resetCeneoTokens } from "../src/modules/ceneo/lib/ceneo-client.ts"
import { odataList, ordersFilter, parseCeneoDate, parseToken, toCeneoWallTime } from "../src/modules/ceneo/lib/odata.ts"
import { limitsOf, liveTransport, orderChanged, toDict, toOrderRow } from "../src/modules/ceneo/lib/kup-teraz.ts"
import { DEMO_STATES, demoOrders, demoTransport } from "../src/modules/ceneo/lib/demo-ceneo.ts"
import { toCeneoOrderDto } from "../src/modules/ceneo/lib/order-dto.ts"

test("odata: every answer shape the Swagger shows comes out as a list", () => {
  assert.deepEqual(odataList({ d: { results: [{ Id: 1 }, { Id: 2 }] } }), [{ Id: 1 }, { Id: 2 }])
  assert.deepEqual(odataList({ d: [{ Id: 1 }] }), [{ Id: 1 }])
  assert.deepEqual(odataList({ d: { Id: 1, Value: "x" } }), [{ Id: 1, Value: "x" }])
  assert.deepEqual(odataList({ value: [{ Id: 3 }] }), [{ Id: 3 }])
  assert.deepEqual(odataList(null), [])
  assert.deepEqual(toDict({ d: [{ Id: 2, Value: "B" }, { Id: 1, Value: "A", Description: "Aa" }, { Value: "no id" }] }), [
    { id: 1, value: "A", description: "Aa" },
    { id: 2, value: "B", description: "B" },
  ])
})

test("dates: Ceneo's local time is Warsaw time, winter and summer", () => {
  assert.equal(parseCeneoDate("2022-01-05T10:20:30")?.toISOString(), "2022-01-05T09:20:30.000Z")
  assert.equal(parseCeneoDate("2026-07-01T12:00:00")?.toISOString(), "2026-07-01T10:00:00.000Z")
  assert.equal(parseCeneoDate("2026-07-01T12:00:00Z")?.toISOString(), "2026-07-01T12:00:00.000Z")
  assert.equal(parseCeneoDate("/Date(1641374430000)/")?.toISOString(), "2022-01-05T09:20:30.000Z")
  assert.equal(parseCeneoDate("yesterday"), null)
  const d = new Date("2026-11-11T12:00:00Z")
  assert.equal(toCeneoWallTime(d), "2026-11-11T13:00:00")
  assert.equal(parseCeneoDate(toCeneoWallTime(d))?.getTime(), d.getTime())
})

test("filter: only whitelisted fields with typed values", () => {
  assert.equal(ordersFilter({ createdFrom: new Date("2026-11-01T00:00:00Z"), stateId: 3 }), "CreatedDate ge datetime'2026-11-01T01:00:00' and OrderStateId eq 3")
  assert.equal(ordersFilter({}), null)
  assert.throws(() => ordersFilter({ stateId: 1.5 }))
})

test("token: read from every shape an OData service may answer with", () => {
  assert.equal(parseToken("abc.def-123456789xyz"), "abc.def-123456789xyz")
  assert.equal(parseToken("Unauthorized"), null)
  assert.equal(parseToken('"abc.def.ghi.jkl.mno"'), "abc.def.ghi.jkl.mno")
  assert.equal(parseToken('{"d":"tok1tok1tok1tok1"}'), "tok1tok1tok1tok1")
  assert.equal(parseToken('{"d":{"GetToken":"tok2tok2tok2tok2"}}'), "tok2tok2tok2tok2")
  assert.equal(parseToken('{"access_token":"tok3tok3tok3tok3","expires_in":900}'), "tok3tok3tok3tok3")
  assert.equal(parseToken("<html>error</html>"), null)
  assert.equal(parseToken(""), null)
})

const KEY = "BA3A5A6F-1111-2222-3333-90F3114B5A3C"

function fakeFetch(script: Array<{ status: number; body: string; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; auth: string | undefined }> = []
  const fn = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, auth: init.headers.Authorization })
    const next = script.shift()
    if (!next) throw new Error("no more answers")
    return { ok: next.status >= 200 && next.status < 300, status: next.status, headers: { get: (n: string) => next.headers?.[n.toLowerCase()] ?? null }, text: async () => next.body }
  }
  return { fn, calls }
}

const client = (f: ReturnType<typeof fakeFetch>, now = () => 1_000_000) => new CeneoClient({ apiKey: KEY, timeoutMs: 1000, fetch: f.fn, sleep: async () => {}, now })

test("client: one token per key, cached, reused by every call", async () => {
  resetCeneoTokens()
  const f = fakeFetch([
    { status: 200, body: '"TOKEN-1-TOKEN-1-TOKEN"' },
    { status: 200, body: '{"d":{"results":[]}}' },
    { status: 200, body: '{"d":[]}' },
  ])
  const c = client(f)
  await Promise.all([c.get("/BasketService.svc/Orders"), c.get("/BasketService.svc/OrderStates")])
  assert.equal(f.calls.filter((x) => x.url.includes("GetToken")).length, 1)
  assert.equal(f.calls[0].auth, `Basic ${KEY}`)
  assert.equal(f.calls[1].auth, "Bearer TOKEN-1-TOKEN-1-TOKEN")
  assert.ok(f.calls[1].url.includes("%24format=json"))
})

test("client: a 401 takes a new token and tries once more", async () => {
  resetCeneoTokens()
  const f = fakeFetch([
    { status: 200, body: "OLD-OLD-OLD-OLD-OLD" },
    { status: 401, body: "expired" },
    { status: 200, body: "NEW-NEW-NEW-NEW-NEW" },
    { status: 200, body: '{"d":[]}' },
  ])
  await client(f).get("/BasketService.svc/OrderStates")
  assert.deepEqual(f.calls.map((x) => x.auth), [`Basic ${KEY}`, "Bearer OLD-OLD-OLD-OLD-OLD", `Basic ${KEY}`, "Bearer NEW-NEW-NEW-NEW-NEW"])
})

test("client: 5xx is retried, 429 waits once, other 4xx fail at once; the key never shows", async () => {
  resetCeneoTokens()
  const ok = fakeFetch([
    { status: 200, body: "TTTTTTTTTTTTTTTTTTTT" },
    { status: 503, body: "busy" },
    { status: 429, body: "slow down", headers: { "retry-after": "2" } },
    { status: 200, body: '{"d":[]}' },
  ])
  assert.deepEqual(await client(ok).get("/BasketService.svc/OrderStates"), { d: [] })
  resetCeneoTokens()
  const bad = fakeFetch([{ status: 403, body: `invalid key ${KEY}` }])
  await assert.rejects(client(bad).token(), (e: unknown) => e instanceof CeneoApiError && e.status === 403 && !e.message.includes(KEY) && e.message.includes("BA3***"))
  assert.equal(bad.calls.length, 1)
  const plusKey = "ab+cd/ef=gh-1234"
  assert.equal(maskSecrets(`url?apiKey=${new URLSearchParams({ k: plusKey }).toString().slice(2)} and ${encodeURIComponent(plusKey)}`, [plusKey]), "url?apiKey=ab+*** and ab+***")
})

test("client: only read methods leave the process; every Ceneo write is a GET too", async () => {
  assert.equal(isReadPath("/BasketService.svc/Orders(guid'a68fad07-7402-49ed-a373-ac59881911aa')/OrderItems"), true)
  assert.equal(isReadPath("/BasketService.svc/ConfirmOrder"), false)
  assert.equal(isReadPath("/BasketService.svc/Orders(guid'x')/OrderItems"), false)
  resetCeneoTokens()
  const f = fakeFetch([{ status: 200, body: "TTTTTTTTTTTTTTTTTTTT" }])
  await assert.rejects(client(f).get("/BasketService.svc/CancelOrder", { id: "1" }), CeneoBlockedError)
  assert.equal(f.calls.length, 1, "only the token request went out")
})

test("transport: orders, items and states through the client, ids lower case", async () => {
  const seen: string[] = []
  const t = liveTransport({
    async get(path, q) {
      seen.push(`${path}?${new URLSearchParams(q).toString()}`)
      if (path.endsWith("/Orders")) return { d: { results: [{ Id: "A68FAD07-7402-49ED-A373-AC59881911AA", DisplayedOrderId: "123ABC", OrderStateId: 1, OrderValue: 40.99, CreatedDate: "2022-01-05T10:20:30" }, { Id: "bad" }] } }
      if (path.endsWith("/OrderItems")) return { d: { results: [{ ShopProductId: "variant_1", Name: "Kubek", Price: 10, Count: 2, TotalItemPrice: 20 }] } }
      return { d: { results: [{ Id: 1, Value: "W", Description: "Wait" }] } }
    },
  })
  const orders = await t.orders({ createdFrom: new Date("2022-01-01T00:00:00Z") }, 20)
  assert.deepEqual(orders.map((o) => o.Id), ["a68fad07-7402-49ed-a373-ac59881911aa"])
  assert.ok(seen[0].includes("%24skip=20") && seen[0].includes("CreatedDate+ge+datetime"))
  assert.equal((await t.items(orders[0].Id))[0].Count, 2)
  assert.deepEqual(await t.states(), [{ id: 1, value: "W", description: "Wait" }])
  await assert.rejects(t.items("1; drop"), /Not a Ceneo order id/)
})

test("order row: items matched to variants by the feed id, problems named", () => {
  const raw = { Id: "a68fad07-7402-49ed-a373-ac59881911aa", DisplayedOrderId: "1", CreatedDate: "2022-01-05T10:20:30", OrderStateId: 7, OrderValue: 50, ProductsValue: 40, DeliveryCost: 10 }
  const items = [
    { ShopProductId: "variant_1", Name: "Kubek", Price: 20, Count: 2, TotalItemPrice: 40 },
    { ShopProductId: "OLD-SKU", Name: "Talerz", Price: 5, Count: 1, TotalItemPrice: 5 },
  ]
  const row = toOrderRow(raw, items, (id) => (id === "variant_1" ? "variant_1" : null), new Set([1, 2]), false)
  assert.equal(row.matched, false)
  assert.deepEqual(row.problems, [{ code: "item_unmatched", detail: "OLD-SKU" }, { code: "state_unknown", detail: "7" }])
  assert.deepEqual(row.amounts, { order: 50, products: 40, delivery: 10 })
  assert.equal(row.ordered_at?.toISOString(), "2022-01-05T09:20:30.000Z")
  const all = toOrderRow(raw, items.slice(0, 1), (id) => id, null, false)
  assert.equal(all.matched, true)
  assert.equal(all.problems, null)
  const stored = JSON.parse(JSON.stringify(all)) as Record<string, unknown>
  assert.equal(orderChanged(stored, all), false)
  assert.equal(orderChanged(stored, { ...all, state_id: 2 }), true)
  const dto = toCeneoOrderDto({ id: "cor_1", ...stored }, new Map([[7, "Wysłane"]]))
  assert.equal(dto.state, "Wysłane")
  assert.equal(dto.items[0].variantId, "variant_1")
})

test("demo: the same orders on every read, from the store's offers, one unmatched a week", async () => {
  const offers = [
    { offerId: "variant_a", title: "Kubek", price: 39.9 },
    { offerId: "variant_b", title: "Talerz", price: 24.5 },
  ]
  const now = Date.parse("2026-11-11T18:00:00Z")
  const a = demoOrders(offers, now)
  assert.deepEqual(demoOrders(offers, now), a)
  assert.ok(a.length >= 14 && a.length <= 28)
  assert.ok(a.every((o) => (parseCeneoDate(o.raw.CreatedDate)?.getTime() ?? Infinity) <= now))
  assert.ok(a.some((o) => o.items.some((i) => i.ShopProductId === "DEMO-USUNIETY-1")))
  assert.ok(a.every((o) => Math.abs((o.raw.OrderValue ?? 0) - (o.raw.ProductsValue ?? 0) - (o.raw.DeliveryCost ?? 0)) < 0.001))
  const t = demoTransport(offers, () => now)
  assert.equal((await t.orders({}, 0)).length, Math.min(20, a.length))
  assert.deepEqual(await t.states(), DEMO_STATES)
  assert.equal((await t.detail(a[0].raw.Id)).shipping[0]?.Email, "klient.demo@example.com")
  assert.deepEqual(demoOrders([], now), [])
})

test("limits: the nested GetExecutionLimits answer as a flat list", () => {
  const body = { Status: "OK", Result: { Response: { Status: "OK", Result: { limits: { limit: [{ function: "bidding.SetProductsBids", execution_per_period: "700", period_executions_left: "500", period_expires: "2022-02-07T03:29:45.693" }] } } } } }
  assert.deepEqual(limitsOf(body), [{ method: "bidding.SetProductsBids", perPeriod: 700, left: 500, expires: "2022-02-07T03:29:45.693" }])
  assert.deepEqual(limitsOf({}), [])
})
