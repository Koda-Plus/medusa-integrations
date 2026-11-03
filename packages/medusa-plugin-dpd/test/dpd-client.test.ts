/**
 * The DPDServices client against the fake: the sandbox host and the two
 * paths, HTTP Basic and the master FID in `x-dpd-fid`, JSON, one fetch per
 * call and never a retry (both operations write), a timeout and a network
 * error as unclear, the password in no message and no log line, the label
 * PDF in no log line, pacing through `sleep`, and a call that would wait for
 * its slot too long refused without a fetch (E1).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DPDSERVICES_HOSTS, DPDSERVICES_PATHS, PACING_MAX_WAIT_MS } from "../src/modules/dpd/lib/constants.ts"
import {
  createDpdServicesClient,
  labelsRequest,
  type DpdServicesClientOptions,
  type GeneratePackagesNumbersRequest,
  type PackagesPickupCallCreateRequest,
  type PackagesPickupCallUpdateRequest,
} from "../src/modules/dpd/lib/dpdservices.ts"
import { KIT_META } from "../src/modules/dpd/lib/kit-meta.ts"
import { FakeDpdServices, loadFixture, TINY_PDF_BASE64 } from "./fake-dpdservices.ts"

const PASSWORD = "test-password-koda-0000"

function logger() {
  const lines: string[] = []
  return { lines, info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`), error: (m: string) => lines.push(`error ${m}`) }
}

function client(fake: FakeDpdServices, extra: Partial<DpdServicesClientOptions> = {}) {
  const log = logger()
  const sleeps: number[] = []
  const c = createDpdServicesClient({
    host: fake.host,
    login: fake.login,
    password: fake.password,
    masterFid: 1000,
    logger: log,
    fetchImpl: fake.fetch,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...extra,
  })
  return { c, log, sleeps }
}

function request(reference = "ful_01ABC", postalCode = "30001", payerFID = 1000): GeneratePackagesNumbersRequest {
  return {
    generationPolicy: "STOP_ON_FIRST_ERROR",
    packages: [
      {
        reference,
        ref1: "1042",
        ref2: "order_01ABC",
        sender: { company: "Koda Supply", address: "ul. Przykładowa 5", city: "Warszawa", countryCode: "PL", postalCode: "00950", phone: "000000001" },
        receiver: { name: "Anna Przykładowa", address: "Przykładowa 2", city: "Kraków", countryCode: "PL", postalCode, phone: "500000001", email: "test@example.com" },
        payerFID,
        parcels: [{ reference: `${reference}-1`, weight: 1.25 }],
      },
    ],
  }
}

test("numbers: one POST to the sandbox path with Basic, the master FID as a string and JSON", async () => {
  const fake = new FakeDpdServices()
  const { c } = client(fake)
  assert.equal(c.host, DPDSERVICES_HOSTS.sandbox)
  const o = await c.generatePackagesNumbers(request())
  assert.equal(o.kind, "ok")
  if (o.kind !== "ok") return
  assert.equal(o.parcels.length, 1)
  assert.equal(o.parcels[0].reference, "ful_01ABC-1")
  assert.match(o.parcels[0].waybill, /^0000899\d{6}Q$/)
  assert.match(String(o.sessionId), /^\d+$/)
  assert.equal(fake.calls.length, 1)
  const h = fake.calls[0].headers
  assert.equal(h.authorization, `Basic ${Buffer.from(`koda-test:${PASSWORD}`).toString("base64")}`)
  assert.equal(h["x-dpd-fid"], "1000")
  assert.equal(h["content-type"], "application/json")
  assert.equal(h.accept, "application/json")
  assert.equal(h["user-agent"], `KodaPlus-Medusa-DPD/${KIT_META.version} (+https://koda.plus)`)
  assert.deepEqual(fake.calls[0].body, request())
})

test("the request goes to host plus path, nowhere else", async () => {
  const urls: string[] = []
  const fake = new FakeDpdServices()
  const spy: typeof fetch = async (input, init) => {
    urls.push(String(input))
    return fake.fetch(input, init)
  }
  const { c } = client(fake, { fetchImpl: spy, host: `${DPDSERVICES_HOSTS.sandbox}/` })
  await c.generatePackagesNumbers(request())
  await c.generateSpedLabels(labelsRequest({ packageReference: "ful_01ABC" }, "A4"))
  assert.deepEqual(urls, [`${DPDSERVICES_HOSTS.sandbox}${DPDSERVICES_PATHS.numbers}`, `${DPDSERVICES_HOSTS.sandbox}${DPDSERVICES_PATHS.labels}`])
})

test("labels: the PDF by the package reference; the body keeps the output fields at the top level (S9)", async () => {
  const fake = new FakeDpdServices()
  const waybills = fake.seedPackage("ful_02", 2)
  const { c, log } = client(fake)
  const body = labelsRequest({ packageReference: "ful_02" }, "LBL_PRINTER")
  assert.deepEqual(body, {
    labelSearchParams: { policy: "STOP_ON_FIRST_ERROR", session: { type: "DOMESTIC", packages: [{ reference: "ful_02" }] } },
    outputDocFormat: "PDF",
    format: "LBL_PRINTER",
    outputType: "BIC3",
    variant: "STANDARD",
  })
  const o = await c.generateSpedLabels(body)
  assert.equal(o.kind, "ok")
  if (o.kind !== "ok") return
  assert.equal(o.pdfBase64, TINY_PDF_BASE64)
  assert.deepEqual(o.waybills, waybills)
  assert.ok(!log.lines.join("\n").includes(TINY_PDF_BASE64.slice(0, 40)), "the PDF never reaches a log line")
  assert.match(log.lines[0], /^info \[dpd\] DPDServices generateSpedLabels: 200 OK trace=fake-trace-\d+ \d+ms$/)
  assert.deepEqual(labelsRequest({ waybills: [waybills[1]] }, "A4", "INTERNATIONAL").labelSearchParams.session, { type: "INTERNATIONAL", packages: [{ parcels: [{ waybill: waybills[1] }] }] })
  const missing = await c.generateSpedLabels(labelsRequest({ packageReference: "nothing" }, "A4"))
  assert.equal(missing.kind, "not_found")
})

test("a duplicate reference is exists; a refused postal code is refused without the echoed value", async () => {
  const fake = new FakeDpdServices()
  const { c } = client(fake)
  assert.equal((await c.generatePackagesNumbers(request())).kind, "ok")
  const again = await c.generatePackagesNumbers(request())
  assert.ok(again.kind === "exists" && again.status === "DUPLICATED_PARCEL_REFERENCE")
  const bad = await c.generatePackagesNumbers(request("ful_03", "30-001"))
  assert.ok(bad.kind === "refused" && bad.code === "incorrect_data")
  if (bad.kind === "refused") assert.ok(!bad.message.includes("30-001"))
  /* The refused reference is free: the same reference with a fixed code goes through (08j). */
  assert.equal((await c.generatePackagesNumbers(request("ful_03"))).kind, "ok")
  const payer = await c.generatePackagesNumbers(request("ful_04", "30001", 1234))
  assert.ok(payer.kind === "refused" && payer.code === "payer_fid")
})

test("one fetch per call, never a retry: 500, timeout, network, a lost answer", async () => {
  const fake = new FakeDpdServices()
  const { c } = client(fake)
  fake.failNext("numbers", { status: 500, text: "<html>Internal error</html>" })
  const five = await c.generatePackagesNumbers(request())
  assert.ok(five.kind === "unclear" && five.code === "server_error")
  assert.equal(fake.count("numbers"), 1)
  fake.failNext("numbers", "timeout")
  const timeout = await c.generatePackagesNumbers(request())
  assert.ok(timeout.kind === "unclear" && timeout.code === "timeout")
  assert.equal(fake.count("numbers"), 2)
  fake.failNext("labels", "network")
  const net = await c.generateSpedLabels(labelsRequest({ packageReference: "ful_01ABC" }, "A4"))
  assert.ok(net.kind === "unclear" && net.code === "network")
  assert.equal(fake.count("labels"), 1)
  fake.failNext("numbers", "lose_answer")
  const lost = await c.generatePackagesNumbers(request("ful_05"))
  assert.ok(lost.kind === "unclear" && lost.code === "network")
  assert.equal(fake.count("numbers"), 3)
  assert.ok(fake.packages.has("ful_05"), "DPD stored the package although the answer was lost")
})

test("a real timeout: the fetch is aborted after timeoutMs and the answer is unclear", async () => {
  const fake = new FakeDpdServices()
  let signalled = false
  const hanging: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        signalled = true
        const err = new Error("This operation was aborted")
        err.name = "AbortError"
        reject(err)
      })
    })
  const { c, log } = client(fake, { fetchImpl: hanging, timeoutMs: 30 })
  const o = await c.generatePackagesNumbers(request())
  assert.ok(o.kind === "unclear" && o.code === "timeout")
  assert.equal(signalled, true)
  assert.match(o.kind === "unclear" ? o.message : "", /30 ms/)
  assert.match(log.lines[0], /^warn \[dpd\] DPDServices generatePackagesNumbers: - timeout trace=- \d+ms$/)
})

test("the password never reaches a message or a log line", async () => {
  const fake = new FakeDpdServices()
  const leaky: typeof fetch = async () => {
    throw new Error(`connect ECONNREFUSED for koda-test:${PASSWORD}@dpdservicesdemo.dpd.com.pl`)
  }
  const { c, log } = client(fake, { fetchImpl: leaky })
  const o = await c.generatePackagesNumbers(request())
  assert.ok(o.kind === "unclear" && o.code === "network")
  assert.ok(o.kind === "unclear" && !o.message.includes(PASSWORD), o.kind === "unclear" ? o.message : "")
  fake.failNext("numbers", { status: 400, body: { errors: [{ userMessage: `bad value ${PASSWORD}`, field: "packages[0].receiver.name" }] } })
  const { c: c2, log: log2 } = client(fake)
  const refused = await c2.generatePackagesNumbers(request())
  assert.equal(refused.kind, "refused")
  assert.ok(!JSON.stringify(refused).includes(PASSWORD))
  const wrong = new FakeDpdServices({ password: "another-password-0000" })
  const { c: c3, log: log3 } = client(wrong, { password: PASSWORD })
  const auth = await c3.generatePackagesNumbers(request())
  assert.ok(auth.kind === "refused" && auth.code === "auth")
  for (const line of [...log.lines, ...log2.lines, ...log3.lines]) assert.ok(!line.includes(PASSWORD), line)
})

test("pacing waits through sleep; a slot further than PACING_MAX_WAIT_MS away is refused without a fetch (E1)", async () => {
  const fake = new FakeDpdServices()
  const { c, sleeps } = client(fake, { requestsPerMinute: 10 })
  /* Sequential calls with a sleep that returns at once never pile up: each waits one gap at most. */
  for (let i = 0; i < 4; i++) await c.generatePackagesNumbers(request(`ful_seq_${i}`))
  assert.equal(fake.count("numbers"), 4)
  assert.ok(sleeps.length >= 3)
  assert.ok(sleeps.every((ms) => ms > 0 && ms <= 6000), String(sleeps))
  /* Calls queued at once: 0, 6, 12 s are within the bound, 18 s is not. */
  const fresh = new FakeDpdServices()
  const { c: q } = client(fresh, { requestsPerMinute: 10 })
  const outcomes = await Promise.all([0, 1, 2, 3].map((i) => q.generatePackagesNumbers(request(`ful_q_${i}`))))
  assert.deepEqual(outcomes.map((o) => o.kind), ["ok", "ok", "ok", "refused"])
  const last = outcomes[3]
  assert.ok(last.kind === "refused" && last.code === "rate_limited" && last.httpStatus === 0)
  assert.equal(fresh.count("numbers"), 3, "the refused call sent nothing")
  assert.ok(PACING_MAX_WAIT_MS < 18_000)
})

/* Stage 4 (spec 5.1.2, 8.1): GET availability, POST/PATCH/DELETE packagesPickupCall, the checkSum as a secret of the call. */

const NOW = () => new Date("2026-11-03T09:00:00Z")

/** The request of a courier fixture with the masked payer, order number and checkSum set. */
function courierBody<T>(name: string, values: { payer?: number; orderNumber?: string; checkSum?: string; pickupDate?: string } = {}): T {
  let raw = JSON.stringify(loadFixture(name).request.body)
  if (values.payer !== undefined) raw = raw.replace(/"number":"\*\*\*"/, `"number":${values.payer}`)
  if (values.orderNumber !== undefined) raw = raw.replace(/"orderNumber":"\*\*\*"/, JSON.stringify({ orderNumber: values.orderNumber }).slice(1, -1))
  if (values.checkSum !== undefined) raw = raw.replace(/"checkSum":"\*+"/, JSON.stringify({ checkSum: values.checkSum }).slice(1, -1))
  if (values.pickupDate !== undefined) raw = raw.replace(/"pickupDate":"[^"]*"/, JSON.stringify({ pickupDate: values.pickupDate }).slice(1, -1))
  const body: T = JSON.parse(raw)
  return body
}

const createBody = () => courierBody<PackagesPickupCallCreateRequest>("12a-order", { payer: 1000, pickupDate: "2026-11-04" })

test("GET availability sends zipCode as five digits in the query, no body, no content-type", async () => {
  const fake = new FakeDpdServices({ now: NOW })
  const { c, log } = client(fake)
  const o = await c.courierOrderAvailability({ countryCode: "PL", zipCode: "02274" })
  assert.equal(o.kind, "ok")
  if (o.kind === "ok") assert.deepEqual(o.ranges.map((r) => r.raw), ["09:00-17:00", "11:00-14:00", "14:00-17:00"])
  assert.equal(fake.calls.length, 1)
  const call = fake.calls[0]
  assert.deepEqual([call.op, call.method, call.path], ["availability", "GET", DPDSERVICES_PATHS.availability])
  assert.deepEqual(call.query, { countryCode: "PL", zipCode: "02274" })
  assert.equal(call.body, null)
  assert.equal(call.headers["content-type"], undefined)
  assert.equal(call.headers["x-dpd-fid"], "1000")
  assert.ok(call.headers.authorization?.startsWith("Basic "))
  assert.equal(log.lines.length, 1)
  assert.ok(!log.lines[0].includes("zipCode") && !log.lines[0].includes("02274"), "the log line shows the path without the query")
})

test("PATCH sends the body, DELETE the query, both with the FID header", async () => {
  const fake = new FakeDpdServices({ courier: "works", now: NOW })
  const { c } = client(fake)
  const created = await c.pickupCallCreate(createBody())
  assert.equal(created.kind, "ok")
  if (created.kind !== "ok") return
  const post = fake.calls[0]
  assert.deepEqual([post.method, post.path, post.query, post.headers["content-type"]], ["POST", DPDSERVICES_PATHS.pickupCall, null, "application/json"])
  const update = courierBody<PackagesPickupCallUpdateRequest>("12u-patch-unknown-order", { orderNumber: created.orderNumber, checkSum: created.checkSum })
  const changed = await c.pickupCallUpdate(update)
  assert.equal(changed.kind, "ok")
  const patch = fake.calls[1]
  assert.deepEqual([patch.op, patch.method, patch.path, patch.query], ["pickupUpdate", "PATCH", DPDSERVICES_PATHS.pickupCall, null])
  assert.deepEqual(patch.body, update)
  assert.equal(patch.headers["content-type"], "application/json")
  assert.equal(patch.headers["x-dpd-fid"], "1000")
  /* A PATCH rotates the checkSum: the DELETE carries the new one. */
  const rotated = changed.kind === "ok" ? changed.checkSum : null
  assert.ok(rotated !== null && rotated !== created.checkSum)
  const deleted = await c.pickupCallDelete({ orderNumber: created.orderNumber, checkSum: rotated ?? "" })
  assert.equal(deleted.kind, "ok")
  const del = fake.calls[2]
  assert.deepEqual([del.op, del.method, del.path, del.body], ["pickupDelete", "DELETE", DPDSERVICES_PATHS.pickupCall, null])
  assert.deepEqual(del.query, { orderNumber: created.orderNumber, checkSum: rotated })
  assert.equal(del.headers["content-type"], undefined)
  assert.equal(del.headers["x-dpd-fid"], "1000")
  assert.equal(fake.orders.get(created.orderNumber)?.canceled, true)
})

test("checkSum is masked in every log line and message, also from the DELETE query", async () => {
  const checkSum = "98765432"
  const fake = new FakeDpdServices({ courier: "works", now: NOW })
  /* A transport error that names the whole URL, query and all. */
  const leaky: typeof fetch = async (input) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    throw new Error(`connect ECONNREFUSED ${href}`)
  }
  const { c, log } = client(fake, { fetchImpl: leaky })
  const network = await c.pickupCallDelete({ orderNumber: "2026000001", checkSum })
  assert.ok(network.kind === "unclear" && network.code === "network")
  assert.ok(!JSON.stringify(network).includes(checkSum), JSON.stringify(network))
  /* DPD echoing the checkSum in a refusal: masked in the message and the problems. */
  const { c: c2, log: log2 } = client(fake)
  fake.failNext("pickupUpdate", { status: 400, body: { errors: [{ field: "checkSum", userMessage: `unknown checkSum ${checkSum}` }] } })
  const refused = await c2.pickupCallUpdate(courierBody<PackagesPickupCallUpdateRequest>("12u-patch-unknown-order", { orderNumber: "2026000001", checkSum }))
  assert.ok(refused.kind === "refused" && refused.code === "checksum")
  assert.ok(!JSON.stringify(refused).includes(checkSum), JSON.stringify(refused))
  fake.failNext("pickupDelete", { status: 500, body: { status: { status: `UNKNOWN_ERROR ${checkSum}` } } })
  const unclear = await c2.pickupCallDelete({ orderNumber: "2026000001", checkSum })
  assert.ok(unclear.kind === "unclear" && unclear.code === "server_error")
  assert.ok(!JSON.stringify(unclear).includes(checkSum), JSON.stringify(unclear))
  const lines = [...log.lines, ...log2.lines]
  assert.equal(lines.length, 3)
  for (const line of lines) assert.ok(!line.includes(checkSum) && !line.includes(PASSWORD), line)
})

test("the courier call log shows the path without the query", async () => {
  const fake = new FakeDpdServices({ courier: "works", now: NOW })
  const { c, log } = client(fake)
  await c.courierOrderAvailability({ countryCode: "PL", zipCode: "02274" })
  await c.pickupCallDelete({ orderNumber: "2026000001", checkSum: "12345678" })
  assert.equal(log.lines.length, 2)
  assert.ok(log.lines[0].includes(DPDSERVICES_PATHS.availability), log.lines[0])
  assert.ok(log.lines[1].includes(DPDSERVICES_PATHS.pickupCall), log.lines[1])
  for (const line of log.lines) {
    assert.ok(!line.includes("?") && !line.includes("orderNumber=") && !line.includes("2026000001") && !line.includes("12345678"), line)
  }
  assert.match(log.lines[1], /^warn \[dpd\] DPDServices .* 400 order_not_found trace=fake-\S+ \d+ms$/)
})

test("pickupCallCreate never logs the whole answer", async () => {
  const fake = new FakeDpdServices({ courier: "works", now: NOW })
  const { c, log } = client(fake)
  const o = await c.pickupCallCreate(createBody())
  assert.equal(o.kind, "ok")
  if (o.kind !== "ok") return
  assert.equal(log.lines.length, 1)
  const line = log.lines[0]
  assert.match(line, /^info \[dpd\] DPDServices .* 200 OK trace=\S+ \d+ms$/)
  assert.ok(!line.includes(o.checkSum) && !line.includes(o.orderNumber) && !line.includes("{"), line)
  /* The demo host (12a): unclear, the sentence and no body either. */
  const demo = new FakeDpdServices({ now: NOW })
  const { c: d, log: dlog } = client(demo)
  const unclear = await d.pickupCallCreate(createBody())
  assert.ok(unclear.kind === "unclear" && unclear.code === "dpd_unknown_error")
  assert.ok(dlog.lines.every((l) => !l.includes("{") && !l.includes("checkSum")), dlog.lines.join("\n"))
})
