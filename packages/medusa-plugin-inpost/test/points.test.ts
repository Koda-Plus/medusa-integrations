/**
 * The locker search: what a query becomes for the public points API, the
 * small shape points get, the cache and the per IP limit of the store route,
 * and the demo lockers.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { demoPoints, searchDemoPoints } from "../src/modules/inpost/lib/demo.ts"
import { cacheKey, cityCase, normalizePoint, pointsParams, pointToMethodData, RateLimiter, TtlCache } from "../src/modules/inpost/lib/points.ts"

const params = (q: Parameters<typeof pointsParams>[0]) => {
  const r = pointsParams(q)
  if ("error" in r) throw new Error(r.error)
  return { mode: r.mode, p: Object.fromEntries(r.params.entries()) }
}

test("a locker code is an exact name lookup of any point type", () => {
  const { mode, p } = params({ q: "ksp 01m" })
  assert.equal(mode, "code")
  assert.equal(p.name, "KSP01M")
  assert.equal(p.type, undefined)
  assert.equal(p.functions, undefined)
})

test("a post code and a place give the nearest lockers first, within 15 km", () => {
  const post = params({ q: "30415" })
  assert.equal(post.mode, "postcode")
  assert.equal(post.p.relative_post_code, "30-415")
  assert.equal(post.p.max_distance, "15000")
  const near = params({ lat: 52.2297, lng: 21.0122, limit: 5 })
  assert.equal(near.mode, "near")
  assert.equal(near.p.relative_point, "52.22970,21.01220")
  assert.equal(near.p.per_page, "5")
  assert.equal(near.p.type, "parcel_locker")
  assert.equal(near.p.functions, "parcel_collect")
})

test("a city is matched as the API wants it: capitalized, with Polish letters kept", () => {
  assert.equal(params({ q: "kraków" }).p.city, "Kraków")
  assert.equal(params({ q: "bielsko-biała" }).p.city, "Bielsko-Biała")
  assert.equal(params({ q: "zielona góra" }).p.city, "Zielona Góra")
  assert.equal(cityCase("ŁÓDŹ"), "Łódź")
})

test("filters: cash on delivery points, every point type, a limit of 25; nonsense and places abroad refused", () => {
  assert.equal(params({ q: "Opole", cod: true }).p.payment_available, "true")
  assert.equal(params({ q: "Opole", type: "any" }).p.type, undefined)
  assert.equal(params({ q: "Opole", limit: 500 }).p.per_page, "25")
  assert.deepEqual(pointsParams({ q: "" }), { error: "query_missing" })
  assert.deepEqual(pointsParams({ q: "<script>" }), { error: "query_invalid" })
  assert.deepEqual(pointsParams({ lat: 40.4, lng: -3.7 }), { error: "query_invalid" })
})

test("a point keeps only public fields, and turns into the shipping method data", () => {
  const p = normalizePoint({
    name: "KSP01M",
    display_name: "InPost Paczkomat KSP01M",
    type: ["parcel_locker"],
    status: "Operating",
    location: { latitude: 52.2297, longitude: 21.0122 },
    location_description: "Przy wejściu",
    opening_hours: "24/7",
    address: { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa" },
    address_details: { city: "Warszawa", province: "mazowieckie", post_code: "00-950", street: "ul. Narzędziowa", building_number: "12", flat_number: null },
    payment_available: true,
    location_247: true,
    distance: 124.4,
    functions: ["parcel_collect"],
    image_url: "https://example.com/x.jpg",
  })
  assert.ok(p)
  assert.equal(p.code, "KSP01M")
  assert.equal(p.distance, 124)
  assert.deepEqual(p.location, { lat: 52.2297, lng: 21.0122 })
  assert.equal("image_url" in p, false)
  assert.deepEqual(pointToMethodData(p), { machine_id: "KSP01M", machine_name: "KSP01M", machine_address: { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" } })
  assert.equal(normalizePoint({ name: "" }), null)
  assert.equal(normalizePoint("x"), null)
})

test("the cache forgets after its time and keeps a bounded number of searches", () => {
  const c = new TtlCache<number>(1000, 2)
  c.set("a", 1, 0)
  assert.equal(c.get("a", 500), 1)
  assert.equal(c.get("a", 1500), undefined)
  c.set("a", 1, 0)
  c.set("b", 2, 0)
  c.set("c", 3, 0)
  assert.equal(c.size, 2)
  assert.equal(c.get("a", 0), undefined, "the oldest goes first")
  const k1 = cacheKey(new URLSearchParams([["city", "Opole"], ["per_page", "10"]]), false)
  const k2 = cacheKey(new URLSearchParams([["per_page", "10"], ["city", "Opole"]]), false)
  assert.equal(k1, k2)
  assert.notEqual(k1, cacheKey(new URLSearchParams([["city", "Opole"], ["per_page", "10"]]), true), "sandbox and production never share a cache entry")
})

test("the store route limit: so many searches a minute per IP, then the seconds to wait", () => {
  const l = new RateLimiter(2)
  assert.deepEqual(l.take("1.2.3.4", 0), { ok: true })
  assert.deepEqual(l.take("1.2.3.4", 1000), { ok: true })
  assert.deepEqual(l.take("1.2.3.4", 2000), { ok: false, retryAfter: 58 })
  assert.deepEqual(l.take("5.6.7.8", 2000), { ok: true }, "another IP is not affected")
  assert.deepEqual(l.take("1.2.3.4", 61_000), { ok: true })
})

test("demo lockers: invented codes and addresses, searchable by code, city, post code and street", () => {
  assert.equal(demoPoints().length, 5)
  assert.ok(demoPoints().every((p) => p.code.startsWith("KSP")))
  assert.deepEqual(searchDemoPoints("ksp02a").map((p) => p.code), ["KSP02A"])
  assert.deepEqual(searchDemoPoints("Kraków").map((p) => p.code), ["KSP02A"])
  assert.deepEqual(searchDemoPoints("00-950").map((p) => p.code), ["KSP01M"])
  assert.equal(searchDemoPoints("", 3).length, 3)
})
