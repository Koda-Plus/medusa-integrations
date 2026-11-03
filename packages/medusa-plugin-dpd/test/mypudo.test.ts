/**
 * The MyPudo client (spec 5.1.3, 8.2, 9): the parameter names pinned (9.2,
 * all [NZ]: a change here is a decision), the URL with the key last or Basic
 * in a header, the answers of the PDF examples (test/fixtures/mypudo) read
 * into the small PointDto, both error shapes, the parser failing open (an
 * entry it does not know is dropped, never a point without services), every
 * transport failure, one fetch per call, and the key in no message and no
 * log line.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { MYPUDO_PATHS, MYPUDO_URL } from "../src/modules/dpd/lib/constants.ts"
import {
  ALPHA3,
  countryOfRaw,
  createMyPudoClient,
  isLockerType,
  limitsOf,
  myPudoUrl,
  normalizePudoItem,
  PARAM_NAMES,
  parseMyPudoError,
  pudoItemsOf,
  toAlpha2,
  toAlpha3,
  type MyPudoClientOptions,
} from "../src/modules/dpd/lib/mypudo.ts"
import type { PickupAuth } from "../src/modules/dpd/lib/options.ts"
import { FakeMyPudo, loadMyPudoFixture, rawPointsOf, type PointRawFixture } from "./fake-mypudo.ts"

const KEY = "mypudo-key-0123456789abcdef"
const KEY_AUTH: PickupAuth = { kind: "key", key: KEY }

type Line = { level: "info" | "warn" | "error"; msg: string }

function logger(lines: Line[]) {
  return {
    info: (msg: string) => lines.push({ level: "info", msg }),
    warn: (msg: string) => lines.push({ level: "warn", msg }),
    error: (msg: string) => lines.push({ level: "error", msg }),
  }
}

/** A client over the fake; `hrefs` holds every URL as it was sent (the fake keeps the parameters only). */
function client(points: PointRawFixture[] = [], extra: Partial<MyPudoClientOptions> = {}) {
  const fake = new FakeMyPudo(points)
  const lines: Line[] = []
  const hrefs: string[] = []
  const fetchImpl: typeof fetch = (input, init) => {
    hrefs.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    return fake.fetch(input, init)
  }
  const c = createMyPudoClient({ auth: KEY_AUTH, timeoutMs: 3000, fetchImpl, secrets: [KEY], logger: logger(lines), requestId: () => "kp1", ...extra })
  return { c, fake, lines, hrefs }
}

const ODD = rawPointsOf("item-odd")[0]

test("PARAM_NAMES are pinned (9.2): every name comes from the PDF only [NZ], a change here is a decision", () => {
  assert.deepEqual(PARAM_NAMES, {
    requestId: "requestID",
    key: "key",
    countryCode: "countryCode",
    zipCode: "zipCode",
    city: "city",
    address: "address",
    latitude: "latitude",
    longitude: "longitude",
    maxDistance: "max_distance_search",
    serviceDisplay: "servicePudo_display",
    maxResults: "maxPudoNumber",
    pudoId: "pudoId",
  })
})

test("URL by address: requestID, alpha-3, zipCode without the dash, servicePudo_display=1, maxPudoNumber=25, the key last", async () => {
  const { c, fake, hrefs } = client()
  const r = await c.search({ by: "address", country: "PL", zip: "02-495", city: "Warszawa", address: "Skoroszewska 11", limit: 25 })
  assert.deepEqual(r, { ok: true, points: [] })
  assert.equal(fake.count(), 1)
  assert.equal(fake.calls[0].path, MYPUDO_PATHS.byAddress)
  assert.deepEqual(fake.calls[0].params, {
    requestID: "kp1",
    countryCode: "POL",
    zipCode: "02495",
    city: "Warszawa",
    address: "Skoroszewska 11",
    servicePudo_display: "1",
    maxPudoNumber: "25",
    key: KEY,
  })
  assert.ok(hrefs[0].startsWith(`${MYPUDO_URL}${MYPUDO_PATHS.byAddress}?requestID=kp1&`), hrefs[0])
  assert.ok(hrefs[0].endsWith(`&key=${KEY}`), "the key goes last")
  assert.equal(fake.calls[0].authorization, null)
})

test("URL by coordinates: three decimals (the cache key, E20), max_distance_search in metres, no maxPudoNumber; details by pudoId", async () => {
  const { c, fake } = client()
  await c.search({ by: "coords", lat: 52.22771, lng: 20.98938, radiusM: 5000, limit: 10 })
  assert.equal(fake.calls[0].path, MYPUDO_PATHS.byLongLat)
  assert.deepEqual(fake.calls[0].params, { requestID: "kp1", latitude: "52.228", longitude: "20.989", max_distance_search: "5000", servicePudo_display: "1", key: KEY })
  await c.details(" pl14509 ")
  assert.equal(fake.calls[1].path, MYPUDO_PATHS.details)
  assert.deepEqual(fake.calls[1].params, { requestID: "kp1", pudoId: "PL14509", servicePudo_display: "1", key: KEY })
})

test("Basic auth: the authorization header and no key in the URL; myPudoUrl adds the key only with kind key", async () => {
  const header = `Basic ${Buffer.from("pickup-login:pickup-password-1").toString("base64")}`
  const { c, fake, hrefs } = client([], { auth: { kind: "basic", header }, secrets: ["pickup-password-1"] })
  await c.details("PL14509")
  assert.equal(fake.calls[0].authorization, header)
  assert.ok(!hrefs[0].includes("key="), hrefs[0])
  assert.equal(myPudoUrl("pudo/details", { pudoId: "PL1" }, { kind: "none" }), `${MYPUDO_URL}pudo/details?pudoId=PL1`)
  assert.equal(myPudoUrl("pudo/details", { pudoId: "PL1" }, KEY_AUTH, "https://example.com/api"), `https://example.com/api/pudo/details?pudoId=PL1&key=${KEY}`)
  /* The default request id: "kp", alphanumeric, at most 30 characters. */
  const own = new FakeMyPudo()
  await createMyPudoClient({ auth: KEY_AUTH, timeoutMs: 3000, fetchImpl: own.fetch, secrets: [KEY] }).details("PL14509")
  assert.match(own.calls[0].params.requestID, /^kp[a-z0-9]{1,28}$/)
})

test("the byaddress example (MP s.18): a PointDto with the zip as NN-NNN, the country alpha-2, numbers from strings", async () => {
  const { c, lines } = client(rawPointsOf("byaddress-ok"))
  const r = await c.search({ by: "address", country: "PL", zip: "01390", limit: 25 })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.points, [
    {
      id: "PL12037",
      name: "Dikom, Okna, Rolety D. Majewski M.Majewska",
      type: "100",
      isLocker: false,
      partner: null,
      address: { line1: "Świetlików 3", line2: null, zip: "01-390", city: "Warszawa", country: "PL" },
      lat: 52.227,
      lng: 20.9105,
      active: true,
      services: ["100", "101", "200"],
      delivery: true,
      cod: true,
      hours: [1, 2, 3, 4].map((day) => ({ day, from: "11:00", to: "18:00" })),
      distance: null,
      limits: { maxKg: 20, box: { kind: "sum", maxSideCm: 150, maxSumCm: 300 } },
    },
  ])
  assert.deepEqual(lines, [], "nothing logged for a good answer")
})

test("the bylonglat example (MP s.22): the distance, Żabka by partner, sorted by distance and cut to the limit", async () => {
  const near = { ...ODD, pudoId: "PL20001", distance: undefined, latitude: "52.2278", longitude: "20.9894" }
  const { c } = client([...rawPointsOf("bylonglat-ok"), near])
  const r = await c.search({ by: "coords", lat: 52.22771, lng: 20.98938, radiusM: 5000, limit: 10 })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.points.map((p) => p.id), ["PL20001", "PL14951"], "measured when MyPudo gives no distance, then sorted")
  assert.ok((r.points[0].distance ?? -1) >= 0 && (r.points[0].distance ?? 99) < 100, String(r.points[0].distance))
  assert.equal(r.points[1].distance, 312)
  assert.equal(r.points[1].partner, "Żabka")
  assert.deepEqual(r.points[1].limits.box, { kind: "fits", sidesCm: [64, 41, 38] })
  assert.deepEqual(r.points[1].hours.at(-1), { day: 4, from: "10:00", to: "14:00" })
  const one = await c.search({ by: "coords", lat: 52.22771, lng: 20.98938, radiusM: 5000, limit: 1 })
  assert.ok(one.ok && one.points.length === 1 && one.points[0].id === "PL20001")
})

test("the details example (MP s.27): unknown service codes ignored, pudoType 400 a locker, only the point asked for (E27)", async () => {
  const { c, lines } = client(rawPointsOf("details-ok"))
  const r = await c.details("PL00001")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.point.services, ["100", "101", "200", "201", "300"], "10001, 10002, 112, 202, P10 to P90 are not in POINT_SERVICES")
  assert.equal(r.point.type, "400")
  assert.equal(r.point.isLocker, true)
  assert.deepEqual(r.point.limits.box, { kind: "fits", sidesCm: [59, 50, 44] }, "a locker before the ALDI partner")
  assert.equal(r.point.partner, "ALDI")
  /* An answer that holds another point than the one asked for is not read as that point. */
  const other = client([{ ...rawPointsOf("details-ok")[0] }], {
    fetchImpl: async () => new Response(JSON.stringify(loadMyPudoFixture("details-ok").body), { status: 200 }),
  })
  const wrong = await other.c.details("PL14509")
  assert.equal(wrong.ok, false)
  if (!wrong.ok) assert.equal(wrong.reason, "invalid_answer")
  assert.equal(other.lines.filter((l) => l.level === "warn").length, 1)
  assert.deepEqual(lines, [])
})

test("odd shapes (item-odd): pudoType a number, latitude a string, alpha-2 country, HH:MM:SS, two ranges a day, wrong hours skipped", () => {
  const p = normalizePudoItem(ODD)
  assert.ok(p)
  assert.equal(p.id, "PL85854", "trimmed and upper case")
  assert.equal(p.type, "400402")
  assert.equal(p.isLocker, true)
  assert.equal(p.lat, 52.2297)
  assert.equal(p.lng, 21.0122)
  assert.equal(p.active, true, '"true" reads as true')
  assert.deepEqual(p.services, ["100", "101"], "202, P10, P90 dropped, 100 once")
  assert.deepEqual(p.address, { line1: "Przykładowa 1", line2: "Pawilon B przy wejściu", zip: "00-950", city: "Warszawa", country: "PL" })
  assert.deepEqual(p.hours, [
    { day: 1, from: "08:30", to: "12:00" },
    { day: 1, from: "14:00", to: "19:00" },
    { day: 2, from: "11:30", to: "19:00" },
  ])
  assert.equal(p.distance, null)
  assert.equal(normalizePudoItem({ ...ODD, pudoType: undefined })?.type, "", "an empty type is allowed")
  assert.equal(normalizePudoItem({ ...ODD, Name: "Wielka litera", name: undefined })?.name, "Wielka litera")
  assert.equal(normalizePudoItem({ ...ODD, active: 0 })?.active, false)
  assert.equal(normalizePudoItem({ ...ODD, servicePudo: ["100", 101] })?.cod, true, "an array of codes too")
  assert.equal(normalizePudoItem({ ...ODD, latitude: "" })?.lat, null)
})

test("fail open, never closed by a missing field (E17): no servicePudo, no active, an active value not known, a country not known", async () => {
  assert.equal(normalizePudoItem(rawPointsOf("item-no-services")[0]), null, "the PDF example as printed has no servicePudo")
  assert.equal(normalizePudoItem({ ...ODD, active: undefined }), null)
  assert.equal(normalizePudoItem({ ...ODD, active: "yes" }), null)
  assert.equal(normalizePudoItem({ ...ODD, country: "XYZ" }), null)
  assert.equal(normalizePudoItem({ ...ODD, country: "US" }), null)
  assert.equal(normalizePudoItem({ ...ODD, pudoId: "1111" }), null)
  for (const key of ["name", "address1", "city"]) assert.equal(normalizePudoItem({ ...ODD, [key]: " " }), null, key)
  assert.equal(normalizePudoItem({ ...ODD, servicePudo: "" })?.delivery, false, "an empty servicePudo is a point without services, an absent one is not")
  assert.equal(normalizePudoItem("PL1"), null)
  /* A list where nothing could be read: invalid_answer, in search and in details. */
  const none = client(rawPointsOf("item-no-services"))
  const s = await none.c.search({ by: "address", country: "PL", zip: "01390", limit: 25 })
  assert.deepEqual(s.ok ? null : s.reason, "invalid_answer")
  const d = await none.c.details("PL12037")
  assert.deepEqual(d.ok ? null : d.reason, "invalid_answer")
  assert.equal(none.lines.filter((l) => l.level === "warn").length, 2)
  /* Some dropped: the rest is the answer, with a warn that counts them and says nothing of their content. */
  const some = client([...rawPointsOf("byaddress-ok"), ...rawPointsOf("item-no-services").map((p) => ({ ...p, pudoId: "PL12038" }))])
  const r = await some.c.search({ by: "address", country: "PL", zip: "01390", limit: 25 })
  assert.ok(r.ok && r.points.length === 1)
  assert.equal(some.lines.length, 1)
  assert.equal(some.lines[0].level, "warn")
  assert.match(some.lines[0].msg, /1 of 2 points dropped/)
  assert.ok(!some.lines[0].msg.includes("Dikom"))
})

test("both error shapes [MP s.5, s.9, s.35]: 601 is no point (details not_found, search empty), 314 and 327 api_error logged as error", async () => {
  assert.deepEqual(parseMyPudoError(loadMyPudoFixture("error-327").body), { code: "327", message: "Klucz lub token autoryzacyjny jest wymagany", notFound: false, auth: true })
  assert.equal(parseMyPudoError(loadMyPudoFixture("details-601").body)?.notFound, true)
  assert.deepEqual(parseMyPudoError(loadMyPudoFixture("details-601-request").body), { code: "REQUEST/BAD_REQUEST", message: "Nie znaleziono PUDO o identyfikatorze PL99999", notFound: true, auth: false })
  assert.deepEqual(parseMyPudoError(loadMyPudoFixture("error-request").body)?.notFound, false)
  assert.equal(parseMyPudoError(loadMyPudoFixture("details-ok").body), null)
  assert.equal(parseMyPudoError({ code: "", message: "x" }), null)
  assert.equal(parseMyPudoError(null), null)

  for (const name of ["details-601", "details-601-request"]) {
    const f = loadMyPudoFixture(name)
    const { c, fake, lines } = client()
    fake.failNext({ status: f.httpStatus, body: f.body })
    const d = await c.details("PL99999")
    assert.deepEqual(d.ok ? null : d.reason, "not_found", name)
    fake.failNext({ status: f.httpStatus, body: f.body })
    assert.deepEqual(await c.search({ by: "address", country: "PL", zip: "00950", limit: 25 }), { ok: true, points: [] }, name)
    assert.deepEqual(lines, [], `${name}: a point that is not there is an answer, not a failure`)
  }
  /* The fake itself answers 601 for an id it does not have. */
  const own = client(rawPointsOf("details-ok"))
  const missing = await own.c.details("PL99999")
  assert.deepEqual(missing.ok ? null : missing.reason, "not_found")

  for (const name of ["error-314", "error-327"]) {
    const f = loadMyPudoFixture(name)
    const { c, fake, lines } = client()
    fake.failNext({ status: f.httpStatus, body: f.body })
    const r = await c.details("PL14509")
    assert.deepEqual(r.ok ? null : r.reason, "api_error", name)
    assert.deepEqual(lines.map((l) => l.level), ["error"], `${name}: a wrong or missing key is logged as an error (E24)`)
    fake.failNext({ status: 200, body: f.body })
    const s = await c.search({ by: "address", country: "PL", zip: "00950", limit: 25 })
    assert.deepEqual(s.ok ? null : s.reason, "api_error", `${name} on HTTP 200`)
  }
  for (const status of [401, 403]) {
    const { c, fake, lines } = client()
    fake.failNext({ status })
    const r = await c.details("PL14509")
    assert.deepEqual(r.ok ? null : r.reason, "api_error", String(status))
    assert.deepEqual(lines.map((l) => l.level), ["error"])
  }
  /* A 401 or 403 with an error body of either shape (a code other than 314 or 327) is still a refused login: error, with the code. */
  const deniedBodies = [{ errors: [{ code: "REQUEST", subcode: "UNAUTHORIZED", userMessage: "Brak autoryzacji" }] }, { code: "401", message: "Unauthorized" }]
  for (const status of [401, 403]) {
    for (const body of deniedBodies) {
      const { c, fake, lines } = client()
      fake.failNext({ status, body })
      const r = await c.details("PL14509")
      assert.deepEqual(r.ok ? null : r.reason, "api_error", `${status} ${JSON.stringify(body)}`)
      assert.deepEqual(lines.map((l) => l.level), ["error"], `${status} ${JSON.stringify(body)}: logged as an error (E24)`)
      assert.match(lines[0].msg, /refused the login or the key \(code (REQUEST\/UNAUTHORIZED|401), HTTP 40[13]\)/)
      assert.ok(!lines[0].msg.includes("Brak autoryzacji"), "the code only, never the message")
    }
  }
  /* Another error of shape 2: api_error with a warn that carries the code only (a MyPudo message may echo a zip or a city). */
  const f = loadMyPudoFixture("error-request")
  const { c, fake, lines } = client()
  fake.failNext({ status: f.httpStatus, body: f.body })
  const r = await c.search({ by: "address", country: "PL", zip: "00950", limit: 25 })
  assert.deepEqual(r.ok ? null : r.reason, "api_error")
  assert.deepEqual(lines.map((l) => l.level), ["warn"])
  assert.ok(!lines[0].msg.includes("maxPudoNumber przyjmuje"), lines[0].msg)
})

test("transport and HTTP: abort is timeout, a thrown fetch network, 500 and 429 http, no JSON or no pudoItems invalid_answer; one fetch each", async () => {
  const cases: Array<[Parameters<FakeMyPudo["failNext"]>[0], string]> = [
    ["timeout", "timeout"],
    ["network", "network"],
    [{ status: 500 }, "http"],
    [{ status: 429, body: "" }, "http"],
    [{ status: 404 }, "http"],
    [{ status: 200, body: "<html>maintenance</html>" }, "invalid_answer"],
    [{ status: 200, body: { requestID: "1" } }, "invalid_answer"],
    [{ status: 200, body: { pudoItems: "none" } }, "invalid_answer"],
  ]
  for (const [failure, reason] of cases) {
    const { c, fake } = client()
    fake.failNext(failure)
    const r = await c.details("PL14509")
    assert.deepEqual(r.ok ? null : r.reason, reason, JSON.stringify(failure))
    assert.equal(fake.count(), 1, "never retried")
  }
  /* A real timeout: the abort of timeoutMs. */
  const slow: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted")
        err.name = "AbortError"
        reject(err)
      })
    })
  const t = await createMyPudoClient({ auth: KEY_AUTH, timeoutMs: 20, fetchImpl: slow, secrets: [KEY] }).search({ by: "coords", lat: 52, lng: 21, radiusM: 5000, limit: 10 })
  assert.deepEqual(t.ok ? null : t.reason, "timeout")
  /* pudoItems as an object around one array [NZ]. */
  assert.equal(pudoItemsOf({ pudoItems: { pudoItem: [1, 2] } })?.length, 2)
  assert.equal(pudoItemsOf({ pudoItems: { a: [1], b: [2] } }), null)
  assert.equal(pudoItemsOf(null), null)
  const wrapped = client([], { fetchImpl: async () => new Response(JSON.stringify({ pudoItems: { pudoItem: rawPointsOf("details-ok") } }), { status: 200 }) })
  assert.equal((await wrapped.c.details("PL00001")).ok, true)
})

test("the key is in no message and no log line, also when the fetch error holds the URL; no credentials: not_configured, zero fetch", async () => {
  for (const failure of ["network", "timeout", { status: 500 }, { status: 401 }] as const) {
    const { c, fake, lines } = client()
    fake.failNext(failure)
    const r = await c.search({ by: "address", country: "PL", zip: "00950", limit: 25 })
    assert.equal(r.ok, false)
    const texts = [r.ok ? "" : r.message, ...lines.map((l) => l.msg)].join("\n")
    assert.ok(!texts.includes(KEY), texts)
    assert.ok(!texts.includes("mypudo.dpd.com.pl"), `no URL in a text: ${texts}`)
    assert.ok(lines.length >= 1)
  }
  /* A key that is not in `secrets` is masked all the same (key= of a URL, and the auth itself). */
  const bare = new FakeMyPudo()
  const lines: Line[] = []
  bare.failNext("network")
  const r = await createMyPudoClient({ auth: KEY_AUTH, timeoutMs: 3000, fetchImpl: bare.fetch, secrets: [], logger: logger(lines) }).details("PL14509")
  assert.ok(!JSON.stringify(r).includes(KEY) && !lines.some((l) => l.msg.includes(KEY)))
  /* Without credentials nothing is called. */
  const none = client([], { auth: { kind: "none" } })
  assert.deepEqual((await none.c.details("PL14509")).ok ? null : "not_configured", "not_configured")
  const s = await none.c.search({ by: "coords", lat: 52, lng: 21, radiusM: 5000, limit: 10 })
  assert.deepEqual(s.ok ? null : s.reason, "not_configured")
  assert.equal(none.fake.count(), 0)
  /* A country outside the map: no points, no call (9.4). */
  const us = client()
  assert.deepEqual(await us.c.search({ by: "address", country: "US", zip: "10001", limit: 25 }), { ok: true, points: [] })
  assert.equal(us.fake.count(), 0)
})

test("alpha-3 (9.4) and the countries of raw points", () => {
  assert.equal(Object.keys(ALPHA3).length, 27)
  assert.equal(toAlpha3("pl"), "POL")
  assert.equal(toAlpha3("DE"), "DEU")
  assert.equal(toAlpha3("US"), null)
  assert.equal(toAlpha2("POL"), "PL")
  assert.equal(toAlpha2("svk"), "SK")
  assert.equal(toAlpha2("USA"), null)
  assert.equal(countryOfRaw("POL"), "PL")
  assert.equal(countryOfRaw("pl"), "PL", "alpha-2 of EU_COUNTRIES too [MP s.9]")
  assert.equal(countryOfRaw("NO"), null)
  assert.equal(countryOfRaw(616), null)
  for (const [a2, a3] of Object.entries(ALPHA3)) assert.equal(toAlpha2(a3), a2)
})

test("limitsOf [MP s.36]: a locker, Żabka by type and by partner, a regular point in Poland, a point abroad; 20 kg each", () => {
  assert.ok(isLockerType("400401") && isLockerType("400402") && isLockerType("400"))
  assert.ok(!isLockerType("500502") && !isLockerType(""))
  assert.deepEqual(limitsOf("400401", null, "PL"), { maxKg: 20, box: { kind: "fits", sidesCm: [59, 50, 44] } })
  assert.deepEqual(limitsOf("400", null, "DE"), { maxKg: 20, box: { kind: "fits", sidesCm: [59, 50, 44] } }, "a locker abroad is a locker")
  assert.deepEqual(limitsOf("500502", null, "PL"), { maxKg: 20, box: { kind: "fits", sidesCm: [64, 41, 38] } })
  assert.deepEqual(limitsOf("100", "Żabka", "PL").box, { kind: "fits", sidesCm: [64, 41, 38] })
  assert.deepEqual(limitsOf("100", "ZABKA Polska", "PL").box, { kind: "fits", sidesCm: [64, 41, 38] })
  assert.deepEqual(limitsOf("300", "ALDI", "PL"), { maxKg: 20, box: { kind: "sum", maxSideCm: 150, maxSumCm: 300 } })
  assert.deepEqual(limitsOf("501", null, "CZ"), { maxKg: 20, box: { kind: "girth", maxLengthCm: 100, maxGirthCm: 250 } })
  /* A copy each time: changing one never changes the next. */
  const a = limitsOf("400401", null, "PL")
  if (a.box.kind === "fits") a.box.sidesCm[0] = 1
  assert.deepEqual(limitsOf("400401", null, "PL").box, { kind: "fits", sidesCm: [59, 50, 44] })
})
