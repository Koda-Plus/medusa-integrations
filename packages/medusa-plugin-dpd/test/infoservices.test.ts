/**
 * The InfoServices client and its pure functions (spec 8): one case per row
 * of the tables 8.2 to 8.5. Rows with a fixture read the masked copies of
 * test/fixtures/infoservices, rows "(PDF)" the pdf-* fixtures, rows
 * "(synthetic)" a body built here. The client never throws, never names its
 * URL, and no log line or message ever carries the login, the password, the
 * channel or the envelope. Nothing here reaches a network.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { INFOSERVICES_NAMESPACE, INFOSERVICES_OPERATIONS, PACING_MAX_WAIT_MS } from "../src/modules/dpd/lib/constants.ts"
import {
  confirmEnvelope,
  createInfoServicesClient,
  customerEventsEnvelope,
  eventSecond,
  isAuthFault,
  parseConfirmResponse,
  parseEventsResponse,
  parseFault,
  statusDedupeKey,
  waybillEventsEnvelope,
  warsawToUtc,
  type InfoServicesClientOptions,
} from "../src/modules/dpd/lib/infoservices.ts"
import { KIT_META } from "../src/modules/dpd/lib/kit-meta.ts"
import { createFakeInfoServices, eventsXml, faultXml, loadInfoFixture, type FakeInfoAnswer, type FakeInfoRequest } from "./fake-infoservices.ts"

/* A test URL: the client is pointed at the fake, never at a host. */
const URL_ = "https://info.example.test/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents"
/* A password with XML characters: it must be escaped in the envelope and absent everywhere else. */
const AUTH = { login: "koda-info-test", password: "info<&pass>-koda-0000", channel: "1000" }
const W = "0000000000002Q"

function logger() {
  const lines: string[] = []
  return { lines, info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`), error: (m: string) => lines.push(`error ${m}`) }
}

function client(answer: FakeInfoAnswer | ((req: FakeInfoRequest) => FakeInfoAnswer), extra: Partial<InfoServicesClientOptions> = {}) {
  const fake = createFakeInfoServices(typeof answer === "function" ? answer : () => answer)
  const log = logger()
  const sleeps: number[] = []
  const c = createInfoServicesClient({
    url: URL_,
    auth: AUTH,
    logger: log,
    fetchImpl: fake.fetchImpl,
    requestsPerMinute: 6000,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...extra,
  })
  return { c, log, calls: fake.calls, sleeps }
}

const ev = (code: string, eventTimeRaw: string, over: Record<string, unknown> = {}) => ({ waybill: W, code, eventTimeRaw, ...over })

/* ------------------------------------------------------------------ */
/* 8.2 getEventsForWaybillV1                                           */
/* ------------------------------------------------------------------ */

test("an empty answer of the demo host is ok with no events (13b, 13d, 13e)", async () => {
  for (const fixture of ["13b-waybill-empty.response.xml", "13d-waybill-unknown.response.xml", "13e-waybill-only-last.response.xml"]) {
    const { c } = client({ fixture })
    const r = await c.getEventsForWaybill(W)
    assert.equal(r.kind, "ok", fixture)
    if (r.kind === "ok") assert.deepEqual(r.value, { confirmId: "0", events: [] }, fixture)
  }
})

test("an empty waybill of the PDF (s.22) is ok with no events", () => {
  const xml = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:getEventsForWaybillV1Response xmlns:ns2="${INFOSERVICES_NAMESPACE}"><return><confirmId>0</confirmId></return></ns2:getEventsForWaybillV1Response></S:Body></S:Envelope>`
  assert.deepEqual(parseEventsResponse(xml), { confirmId: "0", events: [] })
})

test("the PDF waybill answer gives one event with eventTimeRaw kept and objectId as a string", async () => {
  const { c } = client({ fixture: "pdf-waybill-events.response.xml" })
  const r = await c.getEventsForWaybill("0000000000101S")
  assert.equal(r.kind, "ok")
  if (r.kind !== "ok") return
  assert.equal(r.httpStatus, 200)
  assert.deepEqual(r.value.events, [
    {
      waybill: "0000000000101S",
      code: "190101",
      description: "Przesyłka doręczona",
      eventTimeRaw: "2018-02-15T15:52:29.886",
      eventTime: "2018-02-15T14:52:29.886Z",
      depot: "1305",
      depotName: "Warszawa",
      country: "PL",
      objectId: "9000000000000000001",
      data: [{ code: "03", description: "Odbiorca", value: "parcel_x" }],
      queueId: null,
      operationType: null,
    },
  ])
})

test("CDATA sent as entities is unwrapped in eventDataList values", () => {
  const a = parseEventsResponse(loadInfoFixture("pdf-cdata-eventdata.response.xml").body)
  assert.ok(a)
  assert.deepEqual(a.events[0].data.map((d) => [d.code, d.value]), [["01", "parcel_3"], ["02", "parcel_3"], ["03", "parcel_3"]])
  /* A real CDATA section and character references too. */
  const raw = `<S:Envelope xmlns:S="x"><S:Body><r xmlns="y"><return><confirmId>0</confirmId><eventsList><businessCode>190101</businessCode><description><![CDATA[a < b]]> &#65;&#x42;</description><eventTime>2026-07-01T12:00:00</eventTime><waybill>${W}</waybill></eventsList></return></r></S:Body></S:Envelope>`
  assert.equal(parseEventsResponse(raw)?.events[0].description, "a < b AB")
})

test("the repin fixture parses: 170101, then 230403 with the same new waybill under 01, 02 and 03", () => {
  const a = parseEventsResponse(loadInfoFixture("pdf-repin-230403.response.xml").body)
  assert.ok(a)
  assert.deepEqual(a.events.map((e) => e.code), ["170101", "230403"])
  assert.deepEqual(a.events[1].data.map((d) => d.value), ["0000000000302R", "0000000000302R", "0000000000302R"])
})

test("several events keep the answer order (H6) and every prefix reads the same", () => {
  const events = [ev("190101", "2026-07-01T12:00:00"), ev("040101", "2026-06-30T09:00:00"), ev("170101", "2026-07-01T08:00:00")]
  for (const prefix of ["S", "soap", "ns2", ""] as const) {
    const a = parseEventsResponse(eventsXml(events, { prefix }))
    assert.deepEqual(a?.events.map((e) => e.code), ["190101", "040101", "170101"], prefix)
  }
})

test("eventTime with T and with a space, with and without milliseconds", () => {
  const raws = ["2026-07-01T12:00:00", "2026-07-01 12:00:00", "2026-07-01T12:00", "2026-07-01 12:00", "2026-07-01T12:00:00.5", "2026-07-01T12:00:00.123456789"]
  const a = parseEventsResponse(eventsXml(raws.map((r) => ev("170101", r))))
  assert.deepEqual(
    a?.events.map((e) => e.eventTime),
    ["2026-07-01T10:00:00.000Z", "2026-07-01T10:00:00.000Z", "2026-07-01T10:00:00.000Z", "2026-07-01T10:00:00.000Z", "2026-07-01T10:00:00.500Z", "2026-07-01T10:00:00.123Z"],
  )
  assert.deepEqual(a?.events.map((e) => e.eventTimeRaw), raws)
})

test("an unreadable or empty eventTime is ok with eventTime null", () => {
  const a = parseEventsResponse(eventsXml([ev("170101", "yesterday"), ev("170101", "")]))
  assert.deepEqual(a?.events.map((e) => [e.eventTimeRaw, e.eventTime]), [["yesterday", null], ["", null]])
})

test("an eventsList without businessCode is skipped (O31)", () => {
  const xml = eventsXml([ev("", "2026-07-01T12:00:00"), ev("190101", "2026-07-01T13:00:00")])
  assert.deepEqual(parseEventsResponse(xml)?.events.map((e) => e.code), ["190101"])
})

test("objectId 0, empty and absent are null", () => {
  const xml = eventsXml([ev("170101", "2026-07-01T12:00:00", { objectId: "0" }), ev("170101", "2026-07-01T12:00:01", { objectId: "" }), ev("170101", "2026-07-01T12:00:02", { objectId: null })])
  assert.deepEqual(parseEventsResponse(xml)?.events.map((e) => e.objectId), [null, null, null])
})

test("an event without description has description null", () => {
  assert.equal(parseEventsResponse(eventsXml([ev("170101", "2026-07-01T12:00:00")]))?.events[0].description, null)
})

test("another waybill and an empty waybill of an event are kept as sent", () => {
  const a = parseEventsResponse(eventsXml([ev("170101", "2026-07-01T12:00:00", { waybill: "0000000000001Q" }), ev("170101", "2026-07-01T12:00:01", { waybill: "" })]))
  assert.deepEqual(a?.events.map((e) => e.waybill), ["0000000000001Q", ""])
})

test("a wrong password is auth (13f) and a missing authDataV1 is auth (13g)", async () => {
  for (const fixture of ["13f-wrong-password.response.xml", "13g-no-auth.response.xml"]) {
    const { c } = client({ fixture })
    const r = await c.getEventsForWaybill(W)
    assert.equal(r.kind, "auth", fixture)
    assert.equal(r.httpStatus, 500)
    if (r.kind === "auth") assert.match(r.message, /^InfoServices refused the login \(getEventsForWaybillV1\): .+\. Check infoLogin, infoPassword and infoChannel\.$/)
  }
})

test("the PDF Fault (s.9, webserwis typo) and Authorization failed are auth", async () => {
  const { c } = client({ fixture: "pdf-fault-access-denied.response.xml" })
  const r = await c.getEventsForWaybill(W)
  assert.equal(r.kind, "auth")
  if (r.kind === "auth") assert.ok(r.message.includes("Access denied to secured webserwis method"))
  const { c: c2 } = client({ status: 500, body: faultXml("Authorization failed to secure webserwice method") })
  assert.equal((await c2.getEventsForWaybill(W)).kind, "auth")
})

test("a Fault with another text is unclear fault, also under HTTP 200 (O30)", async () => {
  for (const status of [500, 200]) {
    const { c } = client({ status, body: faultXml("Internal error") })
    const r = await c.getEventsForWaybill(W)
    assert.equal(r.kind, "unclear")
    if (r.kind === "unclear") {
      assert.equal(r.code, "fault")
      assert.equal(r.message, "InfoServices getEventsForWaybillV1 answered a SOAP Fault (Server): Internal error.")
      assert.equal(r.httpStatus, status)
    }
  }
  const { c } = client({ status: 200, body: faultXml("Access denied to secured webservice method") })
  assert.equal((await c.getEventsForWaybill(W)).kind, "auth", "an auth Fault under 200 is auth too")
})

test("5xx without a Fault is server_error, even with a <return> in the body", async () => {
  for (const status of [500, 502, 503, 504]) {
    for (const body of ["<html><body>Bad gateway</body></html>", "", eventsXml([])]) {
      const { c } = client({ status, body })
      const r = await c.getEventsForWaybill(W)
      assert.equal(r.kind === "unclear" && r.code, "server_error", `${status} ${body.slice(0, 20)}`)
      if (r.kind === "unclear") assert.equal(r.message, `InfoServices getEventsForWaybillV1 answered HTTP ${status} without a SOAP Fault.`)
    }
  }
})

test("an unreadable 200 is bad_answer", async () => {
  const cut = eventsXml([ev("190101", "2026-07-01T12:00:00")])
  for (const body of ["<html>ok</html>", cut.slice(0, cut.length / 2), `<S:Envelope xmlns:S="x"><S:Body><r/></S:Body></S:Envelope>`, ""]) {
    const { c } = client({ status: 200, body })
    const r = await c.getEventsForWaybill(W)
    assert.equal(r.kind === "unclear" && r.code, "bad_answer", body.slice(0, 30))
    if (r.kind === "unclear") assert.equal(r.message, "InfoServices getEventsForWaybillV1 answered HTTP 200 without a readable <return>.")
  }
})

test("404 and 401 without a Fault are bad_answer, never auth (O30)", async () => {
  for (const status of [404, 401, 403, 302]) {
    const { c } = client({ status, body: "denied" })
    const r = await c.getEventsForWaybill(W)
    assert.equal(r.kind === "unclear" && r.code, "bad_answer", String(status))
    if (r.kind === "unclear") assert.ok(r.message.includes(`HTTP ${status}`))
  }
})

test("a timeout and a network error are nothingSent or unclear as in 8.1", async () => {
  const t = client({ fail: "timeout" }, { timeoutMs: 20 })
  const rt = await t.c.getEventsForWaybill(W)
  assert.deepEqual(rt.kind === "unclear" && [rt.code, rt.httpStatus, rt.message], ["timeout", 0, "InfoServices getEventsForWaybillV1 did not answer within 20 ms."])
  const n = client({ fail: "network" })
  const rn = await n.c.getEventsForWaybill(W)
  assert.deepEqual(rn.kind === "unclear" && [rn.code, rn.httpStatus, rn.message], ["network", 0, "InfoServices getEventsForWaybillV1 could not be reached: fetch failed."])
  assert.equal(n.calls.length, 1, "never a retry")
})

test("pacing past PACING_MAX_WAIT_MS sends nothing", async () => {
  const { c, calls } = client({ fixture: "13b-waybill-empty.response.xml" }, { requestsPerMinute: 1 })
  assert.equal((await c.getEventsForWaybill(W)).kind, "ok")
  const r = await c.getEventsForWaybill(W)
  assert.deepEqual(r, {
    kind: "nothingSent",
    code: "rate_limited",
    message: `Too many InfoServices calls from this server: the next free slot is more than ${PACING_MAX_WAIT_MS / 1000} s away, so nothing was sent.`,
    httpStatus: 0,
    ms: 0,
  })
  assert.equal(calls.length, 1)
})

test("pacing waits through sleep for a slot within the limit", async () => {
  const { c, sleeps, calls } = client({ fixture: "13b-waybill-empty.response.xml" }, { requestsPerMinute: 6 })
  await c.getEventsForWaybill(W)
  await c.getEventsForWaybill(W)
  assert.equal(calls.length, 2)
  assert.equal(sleeps.length, 1)
  assert.ok(sleeps[0] > 9_000 && sleeps[0] <= 10_000, String(sleeps[0]))
})

test("an empty waybill sends nothing", async () => {
  const { c, calls } = client({ fixture: "13b-waybill-empty.response.xml" })
  const r = await c.getEventsForWaybill("  ")
  assert.equal(r.kind === "unclear" && r.code, "bad_answer")
  assert.equal(calls.length, 0)
})

/* ------------------------------------------------------------------ */
/* 8.3 getEventsForCustomerV4                                          */
/* ------------------------------------------------------------------ */

test("the V4 queue keeps the answer order (230403 before 170301)", async () => {
  const { c, calls } = client({ fixture: "pdf-customer-v4.response.xml" })
  const r = await c.getEventsForCustomerV4()
  assert.equal(calls[0].operation, INFOSERVICES_OPERATIONS.customer)
  assert.equal(r.kind, "ok")
  if (r.kind !== "ok") return
  assert.equal(r.value.confirmId, "Y29uZmlybQ==")
  assert.deepEqual(
    r.value.events.map((e) => [e.code, e.queueId, e.operationType, e.objectId, e.description, e.depotName]),
    [
      ["230403", "20057", "INSERT", null, null, null],
      ["170301", "20058", "INSERT", "208750", null, null],
    ],
  )
  assert.deepEqual(r.value.events[1].data.map((d) => d.value), ["parcel_1", "parcel_1"])
})

test("a CANCEL of the queue stays with code empty (O31) and an empty queue keeps its confirmId", () => {
  const cancel = `<S:Envelope xmlns:S="x"><S:Body><ns2:r xmlns:ns2="y"><return><confirmId>abc=</confirmId><eventsList><id>7</id><objectId>208750</objectId><operationType>CANCEL</operationType></eventsList></return></ns2:r></S:Body></S:Envelope>`
  const a = parseEventsResponse(cancel)
  assert.deepEqual(a?.events.map((e) => [e.code, e.operationType, e.objectId, e.queueId]), [["", "CANCEL", "208750", "7"]])
  assert.deepEqual(parseEventsResponse(eventsXml([], { confirmId: "Y29uZmlybQ==" })), { confirmId: "Y29uZmlybQ==", events: [] })
})

test("the queue envelope clamps the limit to 1 to 1000", () => {
  assert.match(customerEventsEnvelope(5000, "PL", AUTH), /<limit>1000<\/limit>/)
  assert.match(customerEventsEnvelope(0, "PL", AUTH), /<limit>1<\/limit>/)
  assert.match(customerEventsEnvelope(100, "PL", AUTH), /<limit>100<\/limit>\n\s+<language>PL<\/language>/)
})

/* ------------------------------------------------------------------ */
/* 8.4 markEventsAsProcessedV1                                         */
/* ------------------------------------------------------------------ */

test("markEventsAsProcessedV1 true and false", async () => {
  const t = client({ fixture: "pdf-confirm.response.xml" })
  const r = await t.c.markEventsAsProcessed("Y29uZmlybQ==")
  assert.deepEqual(r.kind === "ok" && r.value, { confirmed: true })
  assert.equal(t.calls[0].operation, INFOSERVICES_OPERATIONS.confirm)
  const f = client({ body: loadInfoFixture("pdf-confirm.response.xml").body.replace("true", "false") })
  const rf = await f.c.markEventsAsProcessed("Y29uZmlybQ==")
  assert.deepEqual(rf.kind === "ok" && rf.value, { confirmed: false })
  assert.equal(parseConfirmResponse(`<S:Envelope xmlns:S="x"><S:Body><r><return> TRUE </return></r></S:Body></S:Envelope>`), true)
})

test("markEventsAsProcessedV1 with another return is bad_answer; an empty confirmId sends nothing", async () => {
  for (const body of [`<S:Envelope xmlns:S="x"><S:Body><r><return>maybe</return></r></S:Body></S:Envelope>`, `<S:Envelope xmlns:S="x"><S:Body><r/></S:Body></S:Envelope>`]) {
    const { c } = client({ body })
    const r = await c.markEventsAsProcessed("Y29uZmlybQ==")
    assert.equal(r.kind === "unclear" && r.code, "bad_answer")
  }
  const { c, calls } = client({ fixture: "pdf-confirm.response.xml" })
  for (const id of ["", "0"]) assert.equal((await c.markEventsAsProcessed(id)).kind, "unclear")
  assert.equal(calls.length, 0)
  assert.match(confirmEnvelope("Y29uZmlybQ==", AUTH), /<even:markEventsAsProcessedV1>\n\s+<confirmId>Y29uZmlybQ==<\/confirmId>/)
})

/* ------------------------------------------------------------------ */
/* 8.5 eventTime and the dedupe key                                    */
/* ------------------------------------------------------------------ */

test("warsawToUtc and eventSecond follow the 8.5 table", () => {
  const rows: Array<[string, string | null, string]> = [
    ["2018-02-15T15:52:29.886", "2018-02-15T14:52:29.886Z", "2018-02-15T15:52:29"],
    ["2026-07-01T12:00:00", "2026-07-01T10:00:00.000Z", "2026-07-01T12:00:00"],
    ["2026-07-01 12:00", "2026-07-01T10:00:00.000Z", "2026-07-01 12:00"],
    ["2026-10-25T02:30:00", "2026-10-25T00:30:00.000Z", "2026-10-25T02:30:00"],
    ["2026-03-29T02:30:00", "2026-03-29T01:30:00.000Z", "2026-03-29T02:30:00"],
    ["2026-11-03T25:00:00", null, "2026-11-03T25:00:00"],
    ["03.11.2026 12:00", null, "03"],
    ["2026-11-03T12:00:00+01:00", null, "2026-11-03T12:00:00+01:00"],
    ["", null, ""],
  ]
  for (const [raw, utc, second] of rows) {
    assert.equal(warsawToUtc(raw), utc, raw)
    assert.equal(eventSecond(raw), second, raw)
  }
  assert.equal(warsawToUtc("2026-02-30T12:00:00"), null, "no 30 February")
  assert.equal(warsawToUtc("2026-11-03T12:00:00Z"), null)
})

test("statusDedupeKey ignores objectId and keeps the raw second", () => {
  const e = { waybill: "9900000000017D", code: "190101", eventTimeRaw: "2018-02-15T15:52:29.886", depot: "1305" }
  assert.equal(statusDedupeKey("live", e), "st:live:9900000000017D:190101:2018-02-15T15:52:29:1305")
  assert.equal(statusDedupeKey("live", { ...e, depot: null }), "st:live:9900000000017D:190101:2018-02-15T15:52:29:")
  assert.equal(statusDedupeKey("live", { ...e, eventTimeRaw: "2018-02-15T15:52:29" }), statusDedupeKey("live", e), "precision does not matter")
  assert.notEqual(statusDedupeKey("live", { ...e, eventTimeRaw: "2018-02-15 15:52:29" }), statusDedupeKey("live", e), "the separator does")
  assert.equal(statusDedupeKey("sandbox", { ...e, objectId: "1" } as typeof e), "st:sandbox:9900000000017D:190101:2018-02-15T15:52:29:1305")
})

test("parseFault and isAuthFault", () => {
  assert.deepEqual(parseFault(loadInfoFixture("13f-wrong-password.response.xml").body), { faultcode: "soap:Server", faultstring: "Access denied to secured webservice method" })
  assert.equal(parseFault(eventsXml([])), null)
  assert.equal(parseFault("not xml"), null)
  for (const s of ["Access denied to secured webservice method", "AuthData is null", "authorization failed"]) assert.equal(isAuthFault(s), true, s)
  for (const s of ["Internal error", "", null]) assert.equal(isAuthFault(s), false, String(s))
})

test("a body nested past any real answer is null, never a RangeError, and the client answers bad_answer", async () => {
  const deep = "<a>".repeat(20000) + "</a>".repeat(20000)
  assert.equal(parseFault(deep), null)
  assert.equal(parseEventsResponse(deep), null)
  assert.equal(parseConfirmResponse(deep), null)
  const wrapped = `<S:Envelope xmlns:S="x"><S:Body>${"<w>".repeat(20000)}<return><confirmId>0</confirmId></return>${"</w>".repeat(20000)}</S:Body></S:Envelope>`
  assert.equal(parseEventsResponse(wrapped), null)
  const { c } = client({ status: 200, body: deep })
  const r = await c.getEventsForWaybill(W)
  assert.equal(r.kind === "unclear" && r.code, "bad_answer")
  if (r.kind === "unclear") assert.equal(r.message, "InfoServices getEventsForWaybillV1 answered HTTP 200 without a readable <return>.")
  /* A few extra wrappers, as a gateway may add, are still read in document order. */
  const shallow = `<S:Envelope xmlns:S="x"><S:Body>${"<w>".repeat(10)}<return><confirmId>7</confirmId></return>${"</w>".repeat(10)}</S:Body></S:Envelope>`
  assert.deepEqual(parseEventsResponse(shallow), { confirmId: "7", events: [] })
})

test("xsi:nil is read from quoted attributes only, under any prefix and among other attributes", () => {
  const answer = (eventsList: string) => `<S:Envelope xmlns:S="x"><S:Body><r><return><confirmId>0</confirmId>${eventsList}</return></r></S:Body></S:Envelope>`
  const ev = (attrs: string) => `<eventsList${attrs}><businessCode>190101</businessCode><waybill>W1</waybill></eventsList>`
  const rows: Array<[string, number]> = [
    ["", 1],
    [` xsi:nil="true"`, 0],
    [` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil = 'true' `, 0],
    [` a=b x:nil="true"`, 0],
    [` nil=" true "`, 0],
    [` xsi:nil="false"`, 1],
    [` xsi:nil=true`, 1],
    [` a="xsi:nil='true'"`, 1],
    [` xsi:nilx="true"`, 1],
  ]
  for (const [attrs, count] of rows) assert.equal(parseEventsResponse(answer(ev(attrs)))?.events.length, count, attrs)
})

test("a nil <return>, Body or Fault counts as absent: null, and the client answers bad_answer, never an empty ok", async () => {
  const body = (inner: string) => `<S:Envelope xmlns:S="x" xmlns:xsi="i"><S:Body>${inner}</S:Body></S:Envelope>`
  const nilReturn = body(`<ns2:getEventsForWaybillV1Response xmlns:ns2="y"><return xsi:nil="true"/></ns2:getEventsForWaybillV1Response>`)
  assert.equal(parseEventsResponse(nilReturn), null)
  assert.equal(parseConfirmResponse(nilReturn), null)
  /* A nil element holds nothing: a <return> written inside one is not read either. */
  assert.equal(parseEventsResponse(body(`<r xsi:nil="true"><return><confirmId>7</confirmId></return></r>`)), null)
  /* The plain empty <return/> is still an empty ok answer (13b to 13e). */
  assert.deepEqual(parseEventsResponse(body(`<r><return/></r>`)), { confirmId: null, events: [] })
  assert.equal(parseEventsResponse(`<S:Envelope xmlns:S="x" xmlns:xsi="i"><S:Body xsi:nil="true"/></S:Envelope>`), null)
  assert.equal(parseFault(body(`<S:Fault xsi:nil="true"/>`)), null)
  const { c } = client({ status: 200, body: nilReturn })
  const r = await c.getEventsForWaybill(W)
  assert.equal(r.kind === "unclear" && r.code, "bad_answer")
  if (r.kind === "unclear") assert.equal(r.message, "InfoServices getEventsForWaybillV1 answered HTTP 200 without a readable <return>.")
})

test("no character XML 1.0 forbids comes out of the parser: &#0; and its kin stay as written, a raw NUL is dropped", () => {
  const answer = (code: string, description: string) =>
    `<S:Envelope xmlns:S="x"><S:Body><r><return><confirmId>0</confirmId><eventsList><businessCode>${code}</businessCode><description>${description}</description><eventTime>2026-07-01T12:00:00</eventTime><waybill>${W}</waybill><eventDataList><code>03</code><value>parcel_x&#1;</value></eventDataList></eventsList></return></r></S:Body></S:Envelope>`
  /* Character references to forbidden code points are left as written; tab, LF and CR still decode. */
  const refs = parseEventsResponse(answer("19&#0;0101", "Dor&#0;czono &#x1F;&#xFFFE;&#xFFFF;&#9;&#10;&#13;x"))
  assert.ok(refs)
  assert.equal(refs.events[0].code, "19&#0;0101")
  assert.equal(refs.events[0].description, "Dor&#0;czono &#x1F;&#xFFFE;&#xFFFF;\t\n\rx")
  assert.equal(refs.events[0].data[0].value, "parcel_x&#1;")
  /* Raw forbidden characters in a text node or a CDATA are dropped from every leaf. */
  const raw = parseEventsResponse(answer("19\u00000101", "Dor\u0000czono <![CDATA[\u0000\u0008ok￿]]>"))
  assert.ok(raw)
  assert.equal(raw.events[0].code, "190101")
  assert.equal(raw.events[0].description, "Dorczono ok")
  /* JSON.stringify writes a control character as \u00XX, which Postgres jsonb refuses for U+0000 (the stuck row of the finding). */
  for (const a of [refs, raw]) assert.doesNotMatch(JSON.stringify(a), /\\u00(?:0[0-8bcef]|1[0-9a-f])|[￾￿]/)
  /* A businessCode made only of forbidden characters is no businessCode: skipped (O31). */
  assert.deepEqual(parseEventsResponse(answer("\u0000", "x"))?.events, [])
})

test("the cut of description (500) and depotName (100) never splits a surrogate pair: no lone half reaches the jsonb tracking or history", () => {
  const emoji = "\u{1F69A}"
  const answer = (description: string, depotName: string) =>
    `<S:Envelope xmlns:S="x"><S:Body><r><return><confirmId>0</confirmId><eventsList><businessCode>170101</businessCode><description>${description}</description><eventTime>2026-07-01T12:00:00</eventTime><waybill>${W}</waybill><depot>13000</depot><depotName>${depotName}</depotName></eventsList></return></r></S:Body></S:Envelope>`
  /* The pair sits on units 499 and 500 (98 and 99 of depotName): the cut drops the whole character. */
  for (const r of [parseEventsResponse(answer("a".repeat(499) + emoji + "b", "d".repeat(99) + emoji)), parseEventsResponse(answer("a".repeat(499) + "&#x1F69A;b", "d".repeat(99) + "&#128666;"))]) {
    assert.ok(r)
    const e = r.events[0]
    assert.equal(e.description, "a".repeat(499))
    assert.equal(e.depotName, "d".repeat(99))
    assert.doesNotMatch(JSON.stringify(r), /\\ud[89ab][0-9a-f]{2}/i)
  }
  /* A pair that fits stays whole: 498 units plus the two halves is exactly 500. */
  const fits = parseEventsResponse(answer("a".repeat(498) + emoji + "b", "d".repeat(98) + emoji + "e"))
  assert.equal(fits?.events[0].description, "a".repeat(498) + emoji)
  assert.equal(fits?.events[0].depotName, "d".repeat(98) + emoji)
  /* Below the limit nothing is cut. */
  assert.equal(parseEventsResponse(answer(`Doręczono ${emoji}`, "Oddział"))?.events[0].description, `Doręczono ${emoji}`)
})

test("a long start tag costs linear time, and a body past the size cap is never parsed", async () => {
  /* A regex restarted at every character took about 13 s on 200 000 characters without "=" (O(n^2)). */
  const n = 200_000
  for (const attrs of [" " + "a".repeat(n), " a=" + "A".repeat(n), ` a="${"b".repeat(n)}`, " " + "a ".repeat(n / 2)]) {
    const xml = `<soap:Envelope><soap:Body><x${attrs}></x></soap:Body></soap:Envelope>`
    const started = performance.now()
    assert.equal(parseFault(xml), null)
    assert.equal(parseEventsResponse(xml), null)
    assert.ok(performance.now() - started < 1000, `${attrs.slice(0, 8)}: ${performance.now() - started} ms`)
  }
  /* Over 4 000 000 characters: no Fault and no <return> are looked for, so a 2xx is bad_answer and a 5xx is server_error (8.1). */
  const pad = `<!--${"p".repeat(4_000_000)}-->`
  const bigOk = eventsXml([{ waybill: W, code: "190101", eventTimeRaw: "2026-11-03T10:00:00" }]) + pad
  const bigFault = faultXml("Access denied to secured webservice method") + pad
  assert.equal(parseEventsResponse(bigOk), null)
  assert.equal(parseFault(bigFault), null)
  assert.equal(parseEventsResponse(eventsXml([{ waybill: W, code: "190101", eventTimeRaw: "2026-11-03T10:00:00" }]) + `<!--${"p".repeat(1_000_000)}-->`)?.events.length, 1, "under the cap it is read")
  const { c } = client({ status: 200, body: bigOk })
  const r = await c.getEventsForWaybill(W)
  assert.deepEqual(r.kind === "unclear" && [r.code, r.message], ["bad_answer", "InfoServices getEventsForWaybillV1 answered HTTP 200 without a readable <return>."])
  const { c: c5 } = client({ status: 500, body: bigFault })
  const r5 = await c5.getEventsForWaybill(W)
  assert.deepEqual(r5.kind === "unclear" && [r5.code, r5.httpStatus], ["server_error", 500])
})

test("a DOCTYPE never expands and unreadable XML is null", () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><S:Envelope xmlns:S="x"><S:Body><r><return><confirmId>&x;</confirmId></return></r></S:Body></S:Envelope>`
  assert.deepEqual(parseEventsResponse(xxe), { confirmId: "&x;", events: [] })
  for (const bad of ["", "<a>", "<a></b>", "<a/><b/>", "text"]) assert.equal(parseEventsResponse(bad), null, bad)
})

/* ------------------------------------------------------------------ */
/* The request and what never leaks                                    */
/* ------------------------------------------------------------------ */

test("the envelope equals the masked 13b request apart from the credentials", async () => {
  const masked = readFileSync(join(import.meta.dirname, "fixtures", "infoservices", "13b-waybill.request.xml"), "utf8").replace(/\r\n/g, "\n").trim()
  assert.equal(waybillEventsEnvelope(W, "ALL", "PL", { login: "***", password: "***", channel: "***" }), masked)
  const { c, calls } = client({ fixture: "13b-waybill-empty.response.xml" })
  await c.getEventsForWaybill(` ${W} `)
  assert.deepEqual([calls[0].operation, calls[0].waybill, calls[0].select], ["getEventsForWaybillV1", W, "ALL"])
  assert.match(calls[0].body, /<language>PL<\/language>/)
  assert.ok(calls[0].body.includes("<password>info&lt;&amp;pass&gt;-koda-0000</password>"), "the password is escaped")
})

test("the request headers: SOAPAction empty, text/xml and the plugin user agent", async () => {
  const seen: Array<Record<string, string>> = []
  const c = createInfoServicesClient({
    url: URL_,
    auth: AUTH,
    fetchImpl: (async (_u: unknown, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>)
      return new Response(loadInfoFixture("13b-waybill-empty.response.xml").body, { status: 200 })
    }) as typeof fetch,
  })
  await c.getEventsForWaybill(W)
  assert.deepEqual(seen[0], { "content-type": "text/xml; charset=utf-8", soapaction: '""', accept: "text/xml", "user-agent": `KodaPlus-Medusa-DPD/${KIT_META.version} (+https://koda.plus)` })
})

test("log lines never carry the login, the password, the channel or the envelope", async () => {
  const answers: FakeInfoAnswer[] = [
    { fixture: "pdf-waybill-events.response.xml" },
    { fixture: "13f-wrong-password.response.xml" },
    { status: 500, body: faultXml(`Internal error at ${URL_} for ${AUTH.password}`) },
    { status: 502, body: "" },
    { fail: "network" },
  ]
  const messages: string[] = []
  const lines: string[] = []
  for (const a of answers) {
    const t = client(a)
    const r = await t.c.getEventsForWaybill(W)
    if (r.kind !== "ok") messages.push(r.message)
    lines.push(...t.log.lines)
  }
  const text = [...messages, ...lines].join("\n")
  for (const secret of [AUTH.login, AUTH.password, "info&lt;", "authDataV1", "<channel>", "Envelope", URL_, "info.example.test"]) assert.ok(!text.includes(secret), secret)
  assert.ok(messages.some((m) => m === "InfoServices getEventsForWaybillV1 answered a SOAP Fault (Server): Internal error at getEventsForWaybillV1 for ***."), messages.join("\n"))
  assert.deepEqual(
    lines.map((l) => l.replace(/ \d+ms/, " Nms")),
    [
      "info [dpd] infoservices getEventsForWaybillV1: ok 200 Nms",
      "warn [dpd] infoservices getEventsForWaybillV1: auth 500 Nms",
      `warn [dpd] infoservices getEventsForWaybillV1: unclear 500 Nms ${W}`,
      `warn [dpd] infoservices getEventsForWaybillV1: unclear 502 Nms ${W}`,
      `warn [dpd] infoservices getEventsForWaybillV1: unclear - Nms ${W}`,
    ],
  )
})

test("a redirect is not followed: one POST, HTTP 307 is unclear bad_answer", async () => {
  const seen: Array<RequestInit | undefined> = []
  const c = createInfoServicesClient({
    url: URL_,
    auth: AUTH,
    fetchImpl: (async (_u: unknown, init?: RequestInit) => {
      seen.push(init)
      return new Response("", { status: 307, headers: { location: "https://elsewhere.invalid/" } })
    }) as typeof fetch,
  })
  const r = await c.getEventsForWaybill(W)
  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.redirect, "manual")
  assert.deepEqual(r.kind === "unclear" && [r.code, r.httpStatus], ["bad_answer", 307])
  if (r.kind === "unclear") assert.ok(!r.message.includes("elsewhere"), r.message)
})

test("a network error naming the URL is told with the operation name", async () => {
  const c = createInfoServicesClient({
    url: URL_,
    auth: AUTH,
    fetchImpl: (async () => {
      throw new TypeError(`fetch failed`, { cause: new Error(`getaddrinfo ENOTFOUND info.example.test (${URL_})`) })
    }) as typeof fetch,
  })
  const r = await c.getEventsForWaybill(W)
  assert.equal(r.kind === "unclear" && r.code, "network")
  if (r.kind === "unclear") {
    assert.ok(!r.message.includes("example.test"), r.message)
    assert.ok(r.message.includes("ENOTFOUND getEventsForWaybillV1"), r.message)
  }
})

test("the fake builds its answers in INFOSERVICES_NAMESPACE", () => {
  assert.equal(INFOSERVICES_NAMESPACE, "http://events.dpdinfoservices.dpd.com.pl/", "the fake builds its answers in this namespace")
})
