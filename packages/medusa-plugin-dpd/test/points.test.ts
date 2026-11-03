/**
 * The points source (spec 5.1.4, 12): one per mode, sandbox and demo with no
 * fetch at all, the catalog search filtered and sorted like live, the route
 * filter after the cache, every branch of pointProblems, and the cache and
 * the limiter ported from the InPost plugin.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { POINTS_MAX_RESULTS, SANDBOX_PUDO_ID } from "../src/modules/dpd/lib/constants.ts"
import type { PointDto } from "../src/modules/dpd/lib/contract.ts"
import { DEMO_POINT_CATALOG, DEMO_POINTS, DEMO_REFUSED_POINTS } from "../src/modules/dpd/lib/demo.ts"
import { catalogPoint, weekdayHours } from "../src/modules/dpd/lib/mypudo.ts"
import { resolveOptions } from "../src/modules/dpd/lib/options.ts"
import {
  catalogSource,
  createPointsSource,
  distanceM,
  isDeliverable,
  pointProblems,
  pointsCacheKey,
  pointsForRequest,
  RateLimiter,
  SANDBOX_POINTS,
  TtlCache,
  type PointCheck,
} from "../src/modules/dpd/lib/points.ts"
import { SANDBOX } from "./helpers.ts"

const noFetch: typeof fetch = () => {
  throw new Error("test: this source must not call fetch")
}

function point(id: string, extra: Partial<Parameters<typeof catalogPoint>[0]> = {}): PointDto {
  return catalogPoint({ id, name: `Punkt ${id}`, type: "100", line1: "Przykładowa 1", zip: "00-950", city: "Warszawa", active: true, services: ["100", "101"], hours: weekdayHours("08:00", "18:00"), ...extra })
}

const WARSAW = { lat: 52.2297, lng: 21.0122 }

test("catalogSource search: only deliverable points in Poland; by coordinates sorted by distance, by address zip then city then the rest", async () => {
  const src = catalogSource("demo", [
    point("PL1", { city: "Kraków", zip: "30-001", lat: 50.0647, lng: 19.945 }),
    point("PL2", { lat: 52.23, lng: 21.012 }),
    point("PL3", { active: false, lat: 52.2297, lng: 21.0122 }),
    point("PL4", { services: ["200"], lat: 52.2297, lng: 21.0122 }),
    point("DE1", { country: "DE", lat: 52.2297, lng: 21.0122 }),
    point("PL5", { city: "warszawa ", zip: "01-001", lat: 52.4, lng: 21.0 }),
    point("PL6", { city: "Gdańsk", zip: "80-001" }),
  ])
  const near = await src.search({ by: "coords", ...WARSAW })
  assert.ok(near.ok)
  if (!near.ok) return
  assert.deepEqual(near.points.map((p) => p.id), ["PL2", "PL5", "PL1", "PL6"], "nearest first, a point without coordinates last")
  assert.ok((near.points[0].distance ?? 99) < 100)
  assert.equal(near.points[3].distance, null)
  const byZip = await src.search({ by: "address", country: "pl", zip: "30001", city: "Warszawa", address: null })
  assert.ok(byZip.ok)
  if (!byZip.ok) return
  assert.deepEqual(byZip.points.map((p) => p.id), ["PL1", "PL2", "PL5", "PL6"], "the zip, then the city (lower case, spaces trimmed), then catalog order")
  assert.ok(byZip.points.every((p) => p.distance === null))
  assert.deepEqual(await src.search({ by: "address", country: "DE", zip: "10115", city: null, address: null }), { ok: true, points: [] })
  /* A copy each time: a caller changing a point never changes the catalog. */
  near.points[0].address.city = "Zmieniona"
  const again = await src.details("PL2")
  assert.equal(again.status === "ok" ? again.point.address.city : null, "Warszawa")
})

test("catalogSource search: at most POINTS_MAX_RESULTS; details by exact id after normalizing, any state, else not_found", async () => {
  const many = Array.from({ length: 40 }, (_, i) => point(`PL${1000 + i}`))
  const src = catalogSource("sandbox", [...many, point("PL9", { active: false })])
  const r = await src.search({ by: "address", country: "PL", zip: "00950", city: null, address: null })
  assert.ok(r.ok && r.points.length === POINTS_MAX_RESULTS)
  const inactive = await src.details(" pl9 ")
  assert.equal(inactive.status, "ok", "details answers an inactive point; pointProblems refuses it")
  assert.equal(inactive.pudoId, "PL9")
  assert.deepEqual(await src.details("PL99"), { status: "not_found", pudoId: "PL99" })
  assert.equal(src.kind, "sandbox")
})

test("createPointsSource: demo and sandbox never fetch, whatever the credentials; live without MyPudo credentials is not_configured", async () => {
  const demo = createPointsSource(resolveOptions({ demo: true, pickupApiKey: "k" }), { fetchImpl: noFetch })
  assert.equal(demo.kind, "demo")
  const dr = await demo.search({ by: "coords", ...WARSAW })
  assert.ok(dr.ok)
  if (!dr.ok) return
  assert.deepEqual([...dr.points.map((p) => p.id)].sort(), [...DEMO_POINTS].sort(), "the refused demo points never come up in a search")
  for (const p of DEMO_REFUSED_POINTS) {
    const check = await demo.details(p.id)
    assert.equal(check.status, "ok", p.id)
    assert.ok(pointProblems(check, { cod: false }).length > 0, `${p.id} is refused`)
  }
  assert.equal((await demo.details("PL14509")).status, "not_found", "a point outside the demo catalog")
  assert.equal(DEMO_POINT_CATALOG.length, DEMO_POINTS.length)

  const sandbox = createPointsSource(resolveOptions({ ...SANDBOX, pickupLogin: "l", pickupPassword: "p" }), { fetchImpl: noFetch })
  assert.equal(sandbox.kind, "sandbox")
  const sr = await sandbox.search({ by: "address", country: "PL", zip: "02-495", city: "Warszawa", address: null })
  assert.deepEqual(sr.ok ? sr.points.map((p) => p.id) : null, [SANDBOX_PUDO_ID])
  const pl14509 = await sandbox.details(SANDBOX_PUDO_ID)
  assert.equal(pl14509.status, "ok")
  assert.deepEqual(pointProblems(pl14509, { cod: true }), [])
  assert.deepEqual(SANDBOX_POINTS.map((p) => p.id), [SANDBOX_PUDO_ID, "PL0SBX01", "PL0SBX02"])
  assert.deepEqual(pointProblems(await sandbox.details("PL0SBX01"), { cod: false }).map((p) => p.code), ["pudo_inactive"])
  assert.deepEqual(pointProblems(await sandbox.details("PL0SBX02"), { cod: true }).map((p) => p.code), ["pudo_no_delivery", "pudo_no_cod"])

  let calls = 0
  const counting: typeof fetch = async () => {
    calls += 1
    return new Response("{}")
  }
  const live = createPointsSource(resolveOptions({ ...SANDBOX, mode: "live" }), { fetchImpl: counting })
  assert.equal(live.kind, "live")
  assert.deepEqual(await live.search({ by: "coords", ...WARSAW }), { ok: false, reason: "not_configured" })
  assert.deepEqual(await live.details("pl14509"), { status: "unchecked", pudoId: "PL14509", reason: "not_configured" })
  assert.equal(calls, 0)
})

test("createPointsSource live: points abroad and points a parcel cannot go to are left out; 601 is not_found; a failure unchecked", async () => {
  const items = [
    { pudoId: "PL10001", active: true, pudoType: "100", servicePudo: "100;101", name: "A", address1: "Przykładowa 1", zipCode: "00950", city: "Warszawa", country: "POL", latitude: "52.23", longitude: "21.01", distance: "50", openingHoursItems: [] },
    { pudoId: "PL10002", active: false, pudoType: "100", servicePudo: "100", name: "B", address1: "Przykładowa 2", zipCode: "00950", city: "Warszawa", country: "POL", distance: "60", openingHoursItems: [] },
    { pudoId: "DE10001", active: true, pudoType: "100", servicePudo: "100", name: "C", address1: "Beispielweg 1", zipCode: "10115", city: "Berlin", country: "DEU", distance: "70", openingHoursItems: [] },
  ]
  const answers: Array<{ status: number; body: unknown }> = [
    { status: 200, body: { pudoItems: items } },
    { status: 200, body: { code: "601", message: "Nie znaleziono PUDO" } },
    { status: 503, body: "" },
  ]
  const fetchImpl: typeof fetch = async () => {
    const a = answers.shift()
    if (!a) throw new Error("test: one call too many")
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), { status: a.status })
  }
  const live = createPointsSource(resolveOptions({ ...SANDBOX, mode: "live", pickupApiKey: "mypudo-key-0000" }), { fetchImpl, logger: { info() {}, warn() {}, error() {} } })
  const r = await live.search({ by: "coords", ...WARSAW })
  assert.deepEqual(r.ok ? r.points.map((p) => p.id) : null, ["PL10001"])
  assert.deepEqual(await live.details("PL10007"), { status: "not_found", pudoId: "PL10007" })
  assert.deepEqual(await live.details("PL10007"), { status: "unchecked", pudoId: "PL10007", reason: "http" })
})

test("pointProblems: every branch, each with field pudoId and the id as detail", () => {
  const ok = (p: PointDto): PointCheck => ({ status: "ok", pudoId: p.id, point: p })
  assert.deepEqual(pointProblems({ status: "not_found", pudoId: "PL1" }, { cod: true }), [{ code: "pudo_not_found", field: "pudoId", detail: "PL1" }])
  for (const reason of ["not_configured", "timeout", "network", "http", "api_error", "invalid_answer"] as const) {
    assert.deepEqual(pointProblems({ status: "unchecked", pudoId: "PL1", reason }, { cod: true }), [], `${reason}: a warning of the plan, never a problem`)
  }
  assert.deepEqual(pointProblems(ok(point("PL1")), { cod: true }), [])
  assert.deepEqual(pointProblems(ok(point("PL1", { active: false })), { cod: false }), [{ code: "pudo_inactive", field: "pudoId", detail: "PL1" }])
  assert.deepEqual(pointProblems(ok(point("PL1", { services: ["101"] })), { cod: false }).map((p) => p.code), ["pudo_no_delivery"])
  assert.deepEqual(pointProblems(ok(point("PL1", { services: ["100"] })), { cod: false }), [])
  assert.deepEqual(pointProblems(ok(point("PL1", { services: ["100"] })), { cod: true }), [{ code: "pudo_no_cod", field: "pudoId", detail: "PL1" }])
  assert.deepEqual(pointProblems(ok(point("PL1", { active: false, services: ["200"] })), { cod: true }).map((p) => p.code), ["pudo_inactive", "pudo_no_delivery", "pudo_no_cod"])
})

test("isDeliverable and pointsForRequest: cod only at a point with 101 in Poland, the limit from 1 to 25 after the filter", () => {
  assert.equal(isDeliverable(point("PL1"), true), true)
  assert.equal(isDeliverable(point("PL1", { services: ["100"] }), true), false)
  assert.equal(isDeliverable(point("PL1", { services: ["100"] }), false), true)
  assert.equal(isDeliverable(point("CZ1", { country: "CZ" }), true), false, "cash on delivery at a point only in Poland")
  assert.equal(isDeliverable(point("PL1", { active: false }), false), false)
  const list = [point("PL1", { services: ["100"] }), point("PL2"), point("PL3"), point("PL4", { services: ["100"] }), point("PL5")]
  assert.deepEqual(pointsForRequest(list, { query: { by: "coords", lat: 52, lng: 21 }, cod: true, limit: 2 }).map((p) => p.id), ["PL2", "PL3"])
  assert.deepEqual(pointsForRequest(list, { query: { by: "coords", lat: 52, lng: 21 }, cod: false, limit: 0 }).map((p) => p.id), ["PL1"])
  assert.equal(pointsForRequest(list, { query: { by: "coords", lat: 52, lng: 21 }, cod: false, limit: 999 }).length, 5)
  assert.equal(pointsForRequest(list, { query: { by: "coords", lat: 52, lng: 21 }, cod: false, limit: 2.9 }).length, 2)
  assert.equal(distanceM(WARSAW, WARSAW), 0)
  const krakow = distanceM(WARSAW, { lat: 50.0647, lng: 19.945 })
  assert.ok(krakow > 250_000 && krakow < 260_000, String(krakow))
  assert.equal(Number.isInteger(krakow), true)
})

test("pointsCacheKey (DS8): keys sorted, the mode first, no cod and no limit, coordinates rounded to 3 decimals, city and address normalized", () => {
  assert.equal(pointsCacheKey("live", { by: "coords", lat: 52.22771, lng: 20.98938 }), "live?by=coords&lat=52.228&lng=20.989")
  assert.equal(pointsCacheKey("live", { by: "coords", lat: 52.2281, lng: 20.9889 }), pointsCacheKey("live", { by: "coords", lat: 52.22771, lng: 20.98938 }), "about 100 m share one entry")
  assert.notEqual(pointsCacheKey("sandbox", { by: "coords", lat: 52, lng: 21 }), pointsCacheKey("live", { by: "coords", lat: 52, lng: 21 }))
  const a = pointsCacheKey("live", { by: "address", country: "pl", zip: "02-495", city: "  Warszawa  Wola ", address: "Skoroszewska  11" })
  assert.equal(a, "live?address=skoroszewska%2011&by=address&city=warszawa%20wola&country=PL&zip=02495")
  assert.equal(pointsCacheKey("live", { by: "address", country: "PL", zip: "02495", city: "warszawa wola", address: "skoroszewska 11" }), a)
  assert.equal(pointsCacheKey("live", { by: "address", country: "PL", zip: "02495", city: null, address: null }), "live?address=&by=address&city=&country=PL&zip=02495")
  assert.equal(pointsCacheKey("demo", { by: "id", id: " pl14509 " }), "demo?by=id&id=PL14509")
  /* A request carries cod and limit; only its query reaches the key. */
  const request = { query: { by: "coords" as const, lat: 52, lng: 21 }, cod: true, limit: 3 }
  assert.ok(!pointsCacheKey("live", request.query).includes("cod") && !pointsCacheKey("live", request.query).includes("limit"))
})

test("TtlCache: an entry lives ttlMs, a set again moves it to the newest, the oldest go past max", () => {
  const c = new TtlCache<number>(1000, 2)
  c.set("a", 1, 0)
  assert.equal(c.get("a", 1000), 1, "at exactly ttlMs still there")
  assert.equal(c.get("a", 1001), undefined)
  assert.equal(c.size, 0, "an expired entry is removed when read")
  c.set("a", 1, 0)
  c.set("b", 2, 0)
  c.set("a", 3, 0)
  c.set("c", 4, 0)
  assert.equal(c.get("b", 0), undefined, "b was the oldest")
  assert.equal(c.get("a", 0), 3)
  assert.equal(c.get("c", 0), 4)
  assert.equal(c.size, 2)
  assert.equal(new TtlCache<string>(10).get("x"), undefined)
})

test("RateLimiter: perMinute per key in a sliding minute, then retryAfter in whole seconds, at least 1", () => {
  const l = new RateLimiter(2)
  assert.deepEqual(l.take("1.2.3.4", 0), { ok: true })
  assert.deepEqual(l.take("1.2.3.4", 30_000), { ok: true })
  assert.deepEqual(l.take("1.2.3.4", 30_500), { ok: false, retryAfter: 30 })
  assert.deepEqual(l.take("5.6.7.8", 30_500), { ok: true }, "per key")
  assert.deepEqual(l.take("1.2.3.4", 59_999), { ok: false, retryAfter: 1 })
  assert.deepEqual(l.take("1.2.3.4", 60_001), { ok: true }, "the first hit left the window")
  assert.deepEqual(l.take("1.2.3.4", 60_002), { ok: false, retryAfter: 30 })
})

test("RateLimiter: a new address per call never grows it past maxKeys nor makes a call scan every key; idle keys go, a busy one keeps its count", () => {
  const l = new RateLimiter(2, 1000)
  const started = performance.now()
  for (let n = 0; n < 50_000; n += 1) assert.deepEqual(l.take(`2001:db8::${n.toString(16)}`, 1_000 + n), { ok: true })
  const ms = performance.now() - started
  assert.ok(l.size <= 1000, `size ${l.size}`)
  /* 50 000 calls over 50 000 keys: a scan of every key per call took seconds here; bounded work per call takes a fraction of it. */
  assert.ok(ms < 1500, `${Math.round(ms)} ms`)
  /* The address that keeps calling stays in the map with its count, though thousands of others came after its first call. */
  const busy = new RateLimiter(2, 100)
  assert.deepEqual(busy.take("busy", 0), { ok: true })
  for (let n = 0; n < 500; n += 1) {
    busy.take(`other-${n}`, 10 + n)
    if (n % 50 === 0) busy.take("busy", 10 + n)
  }
  assert.equal(busy.take("busy", 600).ok, false, "still limited: its hits were kept")
  /* A minute later every idle key is gone, without a full pass over them. */
  const idle = new RateLimiter(5)
  for (let n = 0; n < 300; n += 1) idle.take(`k${n}`, n)
  assert.equal(idle.size, 300)
  idle.take("late", 70_000)
  assert.equal(idle.size, 1)
})
