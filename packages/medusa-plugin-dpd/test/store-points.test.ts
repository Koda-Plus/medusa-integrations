/**
 * The DPD Pickup point routes of the store (GET /store/dpd/points and
 * /store/dpd/points/:id) and the search of the admin: the query, the
 * catalogs of sandbox and demo, the cash on delivery filter after the cache,
 * the limit per IP, the cache (a counting source shows what reached it), the
 * budget of source calls of the store routes, the answers when the source
 * cannot answer (never a URL), Poland only. No network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { POINTS_STORE_CALLS_PER_MINUTE } from "../src/modules/dpd/lib/constants.ts"
import type { ErrorResponse, PointResponse, PointsResponse } from "../src/modules/dpd/lib/contract.ts"
import { DEMO_POINT_CATALOG } from "../src/modules/dpd/lib/demo.ts"
import { catalogPoint } from "../src/modules/dpd/lib/mypudo.ts"
import { catalogSource, SANDBOX_POINTS } from "../src/modules/dpd/lib/points.ts"
import { clientIp, pointsQueryOf } from "../src/workflows/dpd/points.ts"
import { GET as storeSearch } from "../src/api/store/dpd/points/route.ts"
import { GET as storeDetails } from "../src/api/store/dpd/points/[id]/route.ts"
import { GET as adminSearch } from "../src/api/admin/dpd/points/route.ts"
import { API_KEY, countingPoints, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in the tests")
  }) as typeof fetch
  /* The limiter and the budget live in globalThis, one per process: every test starts with fresh ones. */
  const holder = globalThis as unknown as Record<symbol, unknown>
  delete holder[Symbol.for("koda.dpd.pointsLimiter")]
  delete holder[Symbol.for("koda.dpd.pointsBudget")]
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "the catalogs and the fakes never fetch")
})

type Answer<T> = { status: number; body: T; headers: Record<string, string> }

async function call<T>(handler: (req: never, res: never) => Promise<void>, s: Setup, req: Row = {}): Promise<Answer<T>> {
  const out: Answer<unknown> = { status: 200, body: undefined, headers: {} }
  const res = {
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value
      return res
    },
    status(code: number) {
      out.status = code
      return res
    },
    json(body: unknown) {
      out.body = body
      return res
    },
  }
  await handler({ scope: s.container, query: {}, params: {}, body: {}, headers: {}, ip: "203.0.113.1", ...req } as never, res as never)
  return out as Answer<T>
}

const ids = (a: Answer<PointsResponse>) => a.body.points.map((p) => p.id)

test("search by zip and by place: the sandbox has PL14509 only, demo its five sample points; both only points a parcel can go to", async () => {
  const sandbox = setup(SANDBOX)
  const byZip = await call<PointsResponse>(storeSearch, sandbox, { query: { zip: "02-495" } })
  assert.equal(byZip.status, 200)
  assert.deepEqual(ids(byZip), ["PL14509"], "the refused test points never come out of a search")
  assert.equal(byZip.body.source, "sandbox")
  assert.equal(byZip.headers["cache-control"], "public, max-age=300")
  const near = await call<PointsResponse>(storeSearch, sandbox, { query: { lat: "52.19", lng: "20.93" } })
  assert.deepEqual(ids(near), ["PL14509"])
  assert.equal(typeof near.body.points[0].distance, "number", "a place search measures the distance")

  const demo = setup({ demo: true })
  const all = await call<PointsResponse>(storeSearch, demo, { query: { zip: "00950", city: "Warszawa" } })
  assert.deepEqual(ids(all), DEMO_POINT_CATALOG.map((p) => p.id))
  assert.equal(all.body.source, "demo")
  const warsaw = await call<PointsResponse>(storeSearch, demo, { query: { lat: "52.23", lng: "21.01" } })
  assert.deepEqual(ids(warsaw).slice(0, 2).sort(), ["PL9DEMO01", "PL9DEMO02"], "nearest first")
  assert.ok(!ids(warsaw).includes("PL9DEMO06") && !ids(warsaw).includes("PL9DEMO07"))
})

test("cod=true keeps the points with cash on delivery; limit cuts; both after the cache", async () => {
  const points = countingPoints(catalogSource("demo", DEMO_POINT_CATALOG))
  const s = setup({ demo: true }, [], { points })
  const cod = await call<PointsResponse>(storeSearch, s, { query: { zip: "00-950", cod: "true" } })
  assert.deepEqual(ids(cod), ["PL9DEMO01", "PL9DEMO03", "PL9DEMO04", "PL9DEMO05"], "PL9DEMO02 takes no cash on delivery")
  assert.ok(cod.body.points.every((p) => p.cod))
  const two = await call<PointsResponse>(storeSearch, s, { query: { zip: "00-950", limit: "2" } })
  assert.deepEqual(ids(two), ["PL9DEMO01", "PL9DEMO02"])
  const plain = await call<PointsResponse>(storeSearch, s, { query: { zip: "00950", cod: "false" } })
  assert.equal(plain.body.points.length, 5)
  assert.equal(points.searches, 1, "the same query with another cod and limit does not reach the source again")
})

test("the query: 400 invalid without a search, with both, city without zip, limit 26, a country other than PL, a wrong cod", async () => {
  const s = setup(SANDBOX)
  const bad: Row[] = [
    {},
    { zip: "02-495", lat: "52.1", lng: "20.9" },
    { city: "Warszawa" },
    { lat: "52.1", lng: "20.9", city: "Warszawa" },
    { zip: "02-495", limit: "26" },
    { zip: "02-495", limit: "0" },
    { zip: "02-495", limit: "2.5" },
    { zip: "02-495", country: "DE" },
    { zip: "02-495", cod: "yes" },
    { zip: "2495" },
    { zip: "02-495", city: "x".repeat(51) },
    { lat: "91", lng: "20" },
    { lat: "52" },
  ]
  for (const query of bad) {
    const a = await call<ErrorResponse>(storeSearch, s, { query, ip: `198.51.100.${bad.indexOf(query)}` })
    assert.equal(a.status, 400, JSON.stringify(query))
    assert.equal(a.body.code, "invalid")
    assert.equal(a.body.fields, undefined, "no box index to point at")
  }
  const de = await call<ErrorResponse>(storeSearch, s, { query: { zip: "02-495", country: "DE" } })
  assert.match(de.body.message, /later version/)
  /* The query as the source and the cache get it: rounded, lower case, single spaces. */
  assert.deepEqual(pointsQueryOf({ zip: "02-495", city: "  Warszawa   Wola ", address: "Skoroszewska  11", country: "pl" }), {
    query: { by: "address", country: "PL", zip: "02495", city: "warszawa wola", address: "skoroszewska 11" },
    cod: false,
    limit: 10,
  })
  assert.deepEqual(pointsQueryOf({ lat: ["52.193712"], lng: "20.92781", cod: "true", limit: "25" }), { query: { by: "coords", lat: 52.194, lng: 20.928 }, cod: true, limit: 25 })
})

test("the limit per IP: pointsPerMinute + 1 searches from one address give 429 with Retry-After, another address goes on", async () => {
  const s = setup({ ...SANDBOX, pointsPerMinute: 5 })
  for (let i = 0; i < 5; i += 1) assert.equal((await call<PointsResponse>(storeSearch, s, { query: { zip: "02-495" } })).status, 200)
  const over = await call<ErrorResponse>(storeSearch, s, { query: { zip: "02-495" } })
  assert.equal(over.status, 429)
  assert.equal(over.body.code, "rate_limited")
  assert.match(over.headers["retry-after"], /^\d+$/)
  const details = await call<ErrorResponse>(storeDetails, s, { params: { id: "PL14509" } })
  assert.equal(details.status, 429, "the same limiter for the details")
  assert.equal((await call<PointsResponse>(storeSearch, s, { query: { zip: "02-495" }, ip: "203.0.113.2" })).status, 200)
  assert.equal(clientIp({ ip: "", socket: { remoteAddress: "10.0.0.1" } }), "10.0.0.1")
  assert.equal(clientIp({}), "unknown")
})

test("the cache: a second identical search does not reach the source; a failure is not cached", async () => {
  const points = countingPoints(catalogSource("sandbox", SANDBOX_POINTS))
  const s = setup(SANDBOX, [], { points })
  await call<PointsResponse>(storeSearch, s, { query: { zip: "02-495", city: "Warszawa" } })
  await call<PointsResponse>(storeSearch, s, { query: { zip: "02495", city: " warszawa " } })
  assert.equal(points.searches, 1, "the same normalized query")
  await call<PointsResponse>(storeSearch, s, { query: { lat: "52.19371", lng: "20.92781" } })
  await call<PointsResponse>(storeSearch, s, { query: { lat: "52.19374", lng: "20.92779" } })
  assert.equal(points.searches, 2, "coordinates that differ in the fourth decimal share a key")

  points.fail.search = "timeout"
  const failed = await call<ErrorResponse>(storeSearch, s, { query: { zip: "00-001" } })
  assert.equal(failed.status, 502)
  points.fail.search = undefined
  const again = await call<PointsResponse>(storeSearch, s, { query: { zip: "00-001" } })
  assert.equal(again.status, 200)
  assert.equal(points.searches, 4, "the failure was not cached: asked again")

  const reads = points.reads
  assert.equal((await call<PointResponse>(storeDetails, s, { params: { id: "PL14509" } })).status, 200)
  assert.equal((await call<PointResponse>(storeDetails, s, { params: { id: "pl14509" } })).status, 200)
  assert.equal((await call<ErrorResponse>(storeDetails, s, { params: { id: "PL0SBX99" } })).status, 404)
  assert.equal((await call<ErrorResponse>(storeDetails, s, { params: { id: "PL0SBX99" } })).status, 404)
  assert.equal(points.reads, reads + 2, "details and a missing point are cached too")
})

test("502 and 503 points_unavailable when the source cannot answer, without a URL; live without MyPudo credentials is 503 and fetches nothing", async () => {
  const points = countingPoints(catalogSource("live", SANDBOX_POINTS))
  const s = setup(SANDBOX, [], { points })
  points.fail.search = "timeout"
  const timeout = await call<ErrorResponse>(storeSearch, s, { query: { zip: "02-495" } })
  assert.equal(timeout.status, 502)
  assert.equal(timeout.body.code, "points_unavailable")
  points.fail.search = "not_configured"
  const off = await call<ErrorResponse>(storeSearch, s, { query: { zip: "02-496" } })
  assert.equal(off.status, 503)
  assert.equal(off.body.code, "points_unavailable")
  points.fail.search = undefined
  points.fail.throws = true
  assert.equal((await call<ErrorResponse>(storeSearch, s, { query: { zip: "02-497" } })).status, 502, "a source that throws is a network failure")
  points.fail.throws = false
  points.fail.details = "http"
  assert.equal((await call<ErrorResponse>(storeDetails, s, { params: { id: "PL14509" } })).status, 502)
  for (const a of [timeout, off]) assert.ok(!/https?:|mypudo\.dpd|key=/i.test(JSON.stringify(a.body)), "no URL, no host, no key in the answer")

  const live = setup({ ...SANDBOX, mode: "live", pickupLogin: "", pickupApiKey: "" })
  const none = await call<ErrorResponse>(storeSearch, live, { query: { zip: "02-495" } })
  assert.equal(none.status, 503)
  assert.equal((await call<ErrorResponse>(storeDetails, live, { params: { id: "PL14509" } })).status, 503)
  const keyed = setup({ ...SANDBOX, mode: "live", pickupApiKey: API_KEY }, [], { points: countingPoints(catalogSource("live", [])) })
  assert.ok(!JSON.stringify(await call<ErrorResponse>(storeSearch, keyed, { query: { zip: "02-495" } })).includes(API_KEY))
})

test("details: 200 for a point a parcel can go to; 404 point_not_found for an inactive one, one without service 100, an unknown one; both public, max-age=300", async () => {
  const s = setup(SANDBOX)
  const ok = await call<PointResponse>(storeDetails, s, { params: { id: " pl 14509 " } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.point.id, "PL14509")
  assert.equal(ok.body.point.cod, true)
  assert.equal(ok.body.source, "sandbox")
  assert.equal(ok.headers["cache-control"], "public, max-age=300")
  for (const id of ["PL0SBX01", "PL0SBX02", "PL0SBX99"]) {
    const a = await call<ErrorResponse>(storeDetails, s, { params: { id } })
    assert.equal(a.status, 404, id)
    assert.equal(a.body.code, "point_not_found")
    assert.equal(a.headers["cache-control"], "public, max-age=300")
  }
  const bad = await call<ErrorResponse>(storeDetails, s, { params: { id: "14509" } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, "invalid")
  const demo = setup({ demo: true })
  assert.equal((await call<ErrorResponse>(storeDetails, demo, { params: { id: "PL9DEMO06" } })).status, 404, "inactive")
  assert.equal((await call<ErrorResponse>(storeDetails, demo, { params: { id: "PL9DEMO07" } })).status, 404, "send only")
  assert.equal((await call<PointResponse>(storeDetails, demo, { params: { id: "PL9DEMO03" } })).body.point.type, "500502")
})

test("Poland only: a place search near the border returns no point abroad, a point abroad has no details", async () => {
  const border = [
    catalogPoint({ id: "PL1BRD01", name: "Punkt przy granicy", type: "100", line1: "ul. Graniczna 1", zip: "68-200", city: "Żary", lat: 51.64, lng: 15.14, active: true, services: ["100"] }),
    catalogPoint({ id: "DE1BRD01", name: "Grenzpunkt", type: "100", line1: "Grenzstr. 1", zip: "02943", city: "Weißwasser", country: "DE", lat: 51.5, lng: 14.64, active: true, services: ["100"] }),
  ]
  const s = setup(SANDBOX, [], { points: catalogSource("live", border) })
  const near = await call<PointsResponse>(storeSearch, s, { query: { lat: "51.5", lng: "14.64" } })
  assert.deepEqual(ids(near), ["PL1BRD01"])
  assert.equal((await call<ErrorResponse>(storeDetails, s, { params: { id: "DE1BRD01" } })).status, 404)
})

test("the budget of the store routes: POINTS_STORE_CALLS_PER_MINUTE + 1 misses from many addresses give 503 with Retry-After; the admin search goes on", async () => {
  const points = countingPoints(catalogSource("sandbox", SANDBOX_POINTS))
  const s = setup(SANDBOX, [], { points })
  const zip = (n: number) => `${String(10_000 + n).padStart(5, "0")}`
  for (let n = 0; n < POINTS_STORE_CALLS_PER_MINUTE; n += 1) {
    const a = await call<PointsResponse>(storeSearch, s, { query: { zip: zip(n) }, ip: `10.0.${Math.floor(n / 200)}.${n % 200}` })
    assert.equal(a.status, 200, `miss ${n}`)
  }
  const over = await call<ErrorResponse>(storeSearch, s, { query: { zip: zip(500) }, ip: "10.9.9.9" })
  assert.equal(over.status, 503)
  assert.equal(over.body.code, "points_unavailable")
  assert.match(over.headers["retry-after"], /^\d+$/)
  assert.equal(points.searches, POINTS_STORE_CALLS_PER_MINUTE, "the refused miss never reached the source")
  const hit = await call<PointsResponse>(storeSearch, s, { query: { zip: zip(0) }, ip: "10.9.9.10" })
  assert.equal(hit.status, 200, "a cache hit spends no budget")
  const admin = await call<PointsResponse>(adminSearch, s, { query: { zip: zip(501) } })
  assert.equal(admin.status, 200, "the admin search has no store budget")
  assert.equal(admin.headers["cache-control"], "private, no-store")
})
