import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { computeSignature, parseSignatureHeader, signatureHeader, verifySignature } from "../src/modules/subiekt/lib/signature.ts"

interface Vector {
  name: string
  t: number
  method: string
  path: string
  body: string
  header: string
}
const fixture = JSON.parse(readFileSync(new URL("../contract/examples/signature-vectors.json", import.meta.url), "utf8")) as {
  secret: string
  tolerance_seconds: number
  vectors: Vector[]
}

test("every contract vector produces the documented header", () => {
  for (const v of fixture.vectors) {
    const header = signatureHeader({ secret: fixture.secret, timestamp: v.t, method: v.method, pathAndQuery: v.path, body: v.body })
    assert.equal(header, v.header, v.name)
  }
})

test("bytes and strings hash the same for UTF-8 bodies", () => {
  const v = fixture.vectors.find((x) => x.name === "post-webhook-unicode")!
  const fromBytes = computeSignature({ secret: fixture.secret, timestamp: v.t, method: v.method, pathAndQuery: v.path, body: Buffer.from(v.body, "utf8") })
  assert.equal(`t=${v.t},v1=${fromBytes}`, v.header)
})

test("a valid signature verifies inside the tolerance and fails outside it", () => {
  for (const v of fixture.vectors) {
    const base = { header: v.header, secrets: [fixture.secret], method: v.method, pathAndQuery: v.path, body: v.body }
    assert.deepEqual(verifySignature({ ...base, nowSeconds: v.t + 299 }), { ok: true }, v.name)
    assert.deepEqual(verifySignature({ ...base, nowSeconds: v.t - 300 }), { ok: true }, v.name)
    assert.deepEqual(verifySignature({ ...base, nowSeconds: v.t + 301 }), { ok: false, reason: "stale" }, v.name)
  }
})

test("any change to method, path, body or secret is a mismatch", () => {
  const v = fixture.vectors.find((x) => x.name === "post-order")!
  const base = { header: v.header, secrets: [fixture.secret], method: v.method, pathAndQuery: v.path, body: v.body, nowSeconds: v.t }
  assert.deepEqual(verifySignature({ ...base, method: "PUT" }), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifySignature({ ...base, pathAndQuery: "/v1/orders/x/cancel" }), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifySignature({ ...base, body: v.body.replace("89.9", "8.99") }), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifySignature({ ...base, secrets: ["another-secret-value"] }), { ok: false, reason: "mismatch" })
})

test("rotation: the previous secret still verifies while the new one is rolled out", () => {
  const v = fixture.vectors[0]
  const r = verifySignature({
    header: v.header,
    secrets: ["the-new-secret-0123456789", fixture.secret],
    method: v.method,
    pathAndQuery: v.path,
    body: v.body,
    nowSeconds: v.t,
  })
  assert.deepEqual(r, { ok: true })
})

test("missing, malformed and secretless cases are told apart", () => {
  const base = { secrets: [fixture.secret], method: "GET", pathAndQuery: "/v1/health", body: "", nowSeconds: 1_791_105_271 }
  assert.deepEqual(verifySignature({ ...base, header: undefined }), { ok: false, reason: "missing" })
  assert.deepEqual(verifySignature({ ...base, header: "sha256=abc" }), { ok: false, reason: "malformed" })
  assert.deepEqual(verifySignature({ ...base, header: `t=abc,v1=${"a".repeat(64)}` }), { ok: false, reason: "malformed" })
  assert.deepEqual(verifySignature({ ...base, header: fixture.vectors[0].header, secrets: ["", null] }), { ok: false, reason: "no_secret" })
})

test("the parser keeps every v1 value and ignores unknown schemes", () => {
  const parsed = parseSignatureHeader(`v0=zzz, t=12 ,v1=${"A".repeat(64)},v1=${"b".repeat(64)}`)
  assert.deepEqual(parsed, { timestamp: 12, signatures: ["a".repeat(64), "b".repeat(64)] })
  assert.equal(parseSignatureHeader("t=12"), null)
})
