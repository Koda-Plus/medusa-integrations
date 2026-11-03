/**
 * The sandbox fixtures in the repository are masked and trimmed copies
 * (spec 15.2, errata E17): no credential, no FID of the account, no
 * Cloudflare cookie or ray, no PDF of DPD (it prints the FID), e-mails only
 * at example.com. The probe values of the FID tests stay, they are what the
 * test is about: the header "1234" (06b), "abc" (06e) and "99999999" (06f)
 * and the payer FID 1234 that DPD refused (06c). The same rules hold for the
 * Pickup answers of stage 3 (10a to 10m). The MyPudo fixtures are no
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

test("every stage 2 and stage 3 fixture is there: no protocol (05, stage 4), no routing (09, stage 7)", () => {
  assert.equal(names.length, 46)
  assert.equal(names.filter((n) => n.startsWith("10")).length, 13, "10a to 10m, DPD Pickup")
  assert.ok(names.every((n) => !/^0[59]/.test(n)), names.join(", "))
  for (const n of ["01-numbers-ok", "02a-numbers-same-ref-identical", "03c-labels-by-package-ref-a4", "04a-labels-unknown-package-ref", "06c-payerfid-wrong", "07b-cod-eur-domestic", "08e-postal-code-with-dash", "08i-multi-field-bean-errors", "10a-pickup-pl14509", "10j-labels-pickup-a4", "10m-pickup-19_99kg"]) {
    assert.ok(names.includes(n), n)
  }
})

test("requests: a path of the two operations, Basic ***, the FID header masked or a probe value", () => {
  for (const name of names) {
    const { request } = loadFixture(name)
    assert.equal(request.method, "POST", name)
    assert.ok(Object.values(DPDSERVICES_PATHS).includes(request.path as never), `${name}: ${request.path}`)
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

test("responses: only content-type and www-authenticate, no cookie, no ray, no PDF of DPD", () => {
  for (const name of names) {
    const text = readFileSync(join(DIR, `${name}.json`), "utf8")
    assert.ok(!/set-cookie|cf-ray|__cf_bm|allHeaderNames|"ms"|"date"/i.test(text), name)
    assert.ok(!text.includes("JVBERi"), `${name}: a PDF in base64`)
    const { response } = loadFixture(name)
    assert.ok(Number.isInteger(response.httpStatus), name)
    for (const k of Object.keys(response.headers)) assert.ok(k === "content-type" || k === "www-authenticate", `${name}: ${k}`)
    walk(response.body, (k, v) => {
      if (k === "documentData") assert.ok(v === null || v === "<pdf>", `${name}: documentData`)
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
