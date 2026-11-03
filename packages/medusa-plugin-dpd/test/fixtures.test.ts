/**
 * The sandbox fixtures in the repository are masked and trimmed copies
 * (spec 15.2, errata E17): no credential, no FID of the account, no
 * Cloudflare cookie or ray, no PDF of DPD (it prints the FID), e-mails only
 * at example.com. The probe values of the FID tests stay, they are what the
 * test is about: the header "1234" (06b), "abc" (06e) and "99999999" (06f)
 * and the payer FID 1234 that DPD refused (06c). The same rules hold for the
 * Pickup answers of stage 3 (10a to 10m) and the protocol, availability and
 * courier answers of stage 4 (spec 14.2): pickupAddress.fid and payer.number
 * masked (the probes 1234 of 11k and 12h aside), orderNumber and checkSum of
 * a request masked (the short probe "123" of 12w aside), documentData "" or
 * "<pdf>". The MyPudo fixtures are no
 * recordings (MyPudo has no test host): each names its page of the PDF, and
 * a URL in them carries key=*** only.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DPDSERVICES_PATHS } from "../src/modules/dpd/lib/constants.ts"
import { loadFixture } from "./fake-dpdservices.ts"

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dpdservices")
const names = readdirSync(DIR).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""))

/** The FID header values that are the content of a test, by fixture. */
const PROBE_FID_HEADERS: Record<string, string> = {
  "06b-fid-header-wrong": "1234",
  "06e-fid-header-non-numeric": "abc",
  "06f-fid-header-unknown-big": "99999999",
}
/** The payer FID DPD refused in 06c: a probe value, not the account's. */
const PROBE_PAYER_FIDS: Record<string, number> = { "06c-payerfid-wrong": 1234 }

function walk(v: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(v)) for (const x of v) walk(x, visit)
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      visit(k, x)
      walk(x, visit)
    }
  }
}

test("every fixture up to stage 4 is there: no routing (09, stage 7)", () => {
  assert.equal(names.length, 69)
  assert.equal(names.filter((n) => n.startsWith("10")).length, 13, "10a to 10m, DPD Pickup")
  assert.equal(names.filter((n) => /^(05|11|12)/.test(n)).length, 23, "stage 4: protocol, availability, courier")
  assert.ok(names.every((n) => !/^09/.test(n)), names.join(", "))
  for (const n of [
    "01-numbers-ok", "02a-numbers-same-ref-identical", "03c-labels-by-package-ref-a4", "04a-labels-unknown-package-ref", "06c-payerfid-wrong", "07b-cod-eur-domestic", "08e-postal-code-with-dash", "08i-multi-field-bean-errors", "10a-pickup-pl14509", "10j-labels-pickup-a4", "10m-pickup-19_99kg",
    "05a-protocol-by-package-ref", "05b-labels-after-protocol", "05c-protocol-again", "11a-avail-02274", "11e-avail-de", "11h-protocol-stop-missing", "11n-protocol-no-label", "11p-protocol-all-missing", "12a-order", "12h-order-wrong-payer", "12w-delete-short-checksum",
  ]) {
    assert.ok(names.includes(n), n)
  }
  for (const n of names) assert.ok(!/^(11f|11g|11o|12[bcefpqrst])/.test(n), `${n}: kept out of the repository`)
})

const PATHS: readonly string[] = Object.values(DPDSERVICES_PATHS)

test("requests: GET, POST, PATCH or DELETE on a known path, a query only with GET and DELETE, Basic ***, the FID header masked or a probe value", () => {
  for (const name of names) {
    const { request } = loadFixture(name)
    assert.ok(["GET", "POST", "PATCH", "DELETE"].includes(request.method), `${name}: ${request.method}`)
    assert.ok(PATHS.includes(request.path), `${name}: ${request.path}`)
    if (request.method === "GET" || request.method === "DELETE") assert.ok(request.query !== undefined && Object.keys(request.query).length > 0, `${name}: query`)
    else assert.equal(request.query, undefined, `${name}: no query`)
    assert.ok(!request.path.includes("?"), name)
    assert.deepEqual(Object.keys(request.headers).sort().filter((k) => k !== "x-dpd-fid"), ["authorization"], name)
    assert.equal(request.headers.authorization, "Basic ***", name)
    const fid = request.headers["x-dpd-fid"]
    if (name === "06a-fid-header-missing") assert.equal(fid, undefined, name)
    else assert.equal(fid, PROBE_FID_HEADERS[name] ?? "***", name)
  }
})

test("payerFID is *** in every numbers request (the probe of 06c aside)", () => {
  for (const name of names) {
    const { request } = loadFixture(name)
    if (request.path !== DPDSERVICES_PATHS.numbers) continue
    const payers: unknown[] = []
    walk(request.body, (k, v) => {
      if (k === "payerFID") payers.push(v)
    })
    assert.ok(payers.length > 0, name)
    for (const p of payers) assert.equal(p, PROBE_PAYER_FIDS[name] ?? "***", name)
  }
})

/** The probe values of stage 4 that are what the test is about (spec 14.2 rules 4 and 5). */
const PROBE_PICKUP_FIDS: Record<string, number> = { "11k-protocol-wrong-fid": 1234 }
const PROBE_PAYER_NUMBERS: Record<string, number> = { "12h-order-wrong-payer": 1234 }
const PROBE_CHECKSUMS: Record<string, string> = { "12w-delete-short-checksum": "123" }

test("stage 4 requests: pickupAddress.fid and payer.number ***, orderNumber *** and checkSum ******** (the probes aside)", () => {
  let fids = 0
  let payers = 0
  let checkSums = 0
  for (const name of names) {
    const { request } = loadFixture(name)
    const sent = { ...(request.query ?? {}), ...(request.body !== null && typeof request.body === "object" ? { body: request.body } : {}) }
    walk(sent, (k, v) => {
      if (k === "pickupAddress" && v !== null && typeof v === "object" && "fid" in v) {
        fids += 1
        assert.equal(v.fid, PROBE_PICKUP_FIDS[name] ?? "***", `${name}: pickupAddress.fid`)
      }
      if (k === "payer" && v !== null && typeof v === "object" && "number" in v) {
        payers += 1
        assert.equal(v.number, PROBE_PAYER_NUMBERS[name] ?? "***", `${name}: payer.number`)
      }
      if (k === "checkSum") {
        checkSums += 1
        assert.equal(v, PROBE_CHECKSUMS[name] ?? "********", `${name}: checkSum`)
      }
      if (k === "orderNumber") assert.equal(v, "***", `${name}: orderNumber`)
    })
  }
  assert.ok(fids >= 2 && payers >= 4 && checkSums === 3, `${fids} ${payers} ${checkSums}`)
  /* In the answers the null values of the test host stay: orderNumber null, checkSum "null" or null. */
  for (const name of names.filter((n) => n.startsWith("12"))) {
    walk(loadFixture(name).response.body, (k, v) => {
      if (k === "checkSum") assert.ok(v === null || v === "null", `${name}: answer checkSum`)
      if (k === "orderNumber") assert.equal(v, null, `${name}: answer orderNumber`)
    })
  }
})

test("responses: only content-type and www-authenticate, no cookie, no ray, no PDF of DPD", () => {
  for (const name of names) {
    const text = readFileSync(join(DIR, `${name}.json`), "utf8")
    assert.ok(!/set-cookie|cf-ray|__cf_bm|allHeaderNames|"ms"|"date"/i.test(text), name)
    assert.ok(!text.includes("JVBERi"), `${name}: a PDF in base64`)
    const { response } = loadFixture(name)
    assert.ok(Number.isInteger(response.httpStatus), name)
    for (const k of Object.keys(response.headers)) assert.ok(k === "content-type" || k === "www-authenticate", `${name}: ${k}`)
    walk(response.body, (k, v) => {
      if (k === "documentData") assert.ok(v === null || v === "" || v === "<pdf>", `${name}: documentData`)
    })
  }
})

test("e-mails only at example.com; the login only masked in the references DPD prefixes with it", () => {
  for (const name of names) {
    const text = readFileSync(join(DIR, `${name}.json`), "utf8")
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)) assert.equal(m[1], "example.com", `${name}: ${m[0]}`)
    for (const m of text.matchAll(/"([^"#]*)#probe-/g)) assert.equal(m[1], "***", `${name}: a login before #`)
    assert.ok(!text.includes("koda-test"), name)
  }
})

const MYPUDO_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mypudo")

test("MyPudo fixtures: each names its source in the PDF, no key other than ***, no e-mail", () => {
  const files = readdirSync(MYPUDO_DIR).filter((n) => n.endsWith(".json"))
  assert.equal(files.length, 10)
  for (const file of files) {
    const text = readFileSync(join(MYPUDO_DIR, file), "utf8")
    const f = JSON.parse(text) as { source?: unknown; httpStatus?: unknown; body?: unknown }
    assert.ok(typeof f.source === "string" && /^MP s\.\d+/.test(f.source), `${file}: source`)
    assert.ok(Number.isInteger(f.httpStatus), `${file}: httpStatus`)
    assert.ok(f.body !== undefined, `${file}: body`)
    for (const m of text.matchAll(/[?&]key=([^&"\s]*)/g)) assert.equal(m[1], "***", `${file}: key=`)
    assert.ok(!/authorization/i.test(text), `${file}: no header`)
    assert.ok(!/@[A-Za-z0-9-]+\.[A-Za-z]/.test(text), `${file}: an e-mail`)
  }
})
