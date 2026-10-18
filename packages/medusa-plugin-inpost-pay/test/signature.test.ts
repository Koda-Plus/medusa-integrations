/**
 * The signature of InPost's calls, built the way the documentation's
 * openssl steps build it: base64(SHA-256(body)), the comma-joined string
 * with the merchant external id, the key version and the timestamp, base64
 * of that, SHA256withRSA. A changed body, an old timestamp, a foreign key
 * hash or another key are refused.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createSign, generateKeyPairSync } from "node:crypto"
import { bodyDigest, keyHashMatches, publicKeyOf, safeKeyVersion, signedPayload, verifyInpostSignature } from "../src/modules/inpostpay/lib/signature.ts"

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const PUBLIC_B64 = publicKey.export({ type: "spki", format: "der" }).toString("base64")
const KEY = { public_key_base64: PUBLIC_B64, merchant_external_id: "merchant-ext-1" }
const other = generateKeyPairSync("rsa", { modulusLength: 2048 })

function signed(body: string, opts: { timestamp?: string; version?: string; key?: typeof privateKey; hash?: string } = {}) {
  const timestamp = opts.timestamp ?? new Date().toISOString()
  const version = opts.version ?? "3"
  const payload = signedPayload({ digest: bodyDigest(body), merchantExternalId: KEY.merchant_external_id, keyVersion: version, timestamp })
  const signature = createSign("RSA-SHA256").update(payload).sign(opts.key ?? privateKey).toString("base64")
  return {
    "x-signature": signature,
    "x-signature-timestamp": timestamp,
    "x-public-key-ver": version,
    "x-public-key-hash": opts.hash ?? createHash("sha256").update(PUBLIC_B64).digest("hex"),
  }
}

test("signature: the documented string verifies", () => {
  const body = '{"order_details":{"basket_id":"ipbsk_1"}}'
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body), key: KEY }), { ok: true })
  assert.deepEqual(verifyInpostSignature({ body: Buffer.from(body) as unknown as Uint8Array, headers: signed(body), key: KEY }), { ok: true })
})

test("signature: an empty body is the digest of no bytes", () => {
  assert.equal(bodyDigest(""), createHash("sha256").update(new Uint8Array(0)).digest("base64"))
  assert.equal(bodyDigest(undefined), bodyDigest(""))
  assert.deepEqual(verifyInpostSignature({ body: undefined, headers: signed(""), key: KEY }), { ok: true })
})

test("signature: the signed string is base64 of the four values with commas", () => {
  const s = signedPayload({ digest: "D", merchantExternalId: "M", keyVersion: "V", timestamp: "T" })
  assert.equal(Buffer.from(s, "base64").toString("utf8"), "D,M,V,T")
})

test("signature: a changed body, another key or a missing signature are refused", () => {
  const body = '{"a":1}'
  assert.deepEqual(verifyInpostSignature({ body: '{"a":2}', headers: signed(body), key: KEY }), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { key: other.privateKey }), key: KEY }), { ok: false, reason: "mismatch" })
  const h = signed(body) as Record<string, string>
  delete h["x-signature"]
  assert.deepEqual(verifyInpostSignature({ body, headers: h, key: KEY }), { ok: false, reason: "missing_signature" })
})

test("signature: the timestamp must be within 240 seconds", () => {
  const body = "{}"
  const old = new Date(Date.now() - 241_000).toISOString()
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { timestamp: old }), key: KEY }), { ok: false, reason: "stale" })
  const near = new Date(Date.now() - 200_000).toISOString()
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { timestamp: near }), key: KEY }), { ok: true })
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { timestamp: "yesterday" }), key: KEY }), { ok: false, reason: "stale" })
})

test("signature: the key hash names the key, hex or base64", () => {
  const body = "{}"
  const b64 = createHash("sha256").update(PUBLIC_B64).digest("base64")
  assert.ok(keyHashMatches(PUBLIC_B64, b64))
  assert.ok(keyHashMatches(PUBLIC_B64, createHash("sha256").update(PUBLIC_B64).digest("hex").toUpperCase()))
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { hash: b64 }), key: KEY }), { ok: true })
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { hash: "00".repeat(32) }), key: KEY }), { ok: false, reason: "key_hash" })
  const bad = { public_key_base64: "bm90IGEga2V5", merchant_external_id: "m" }
  assert.deepEqual(verifyInpostSignature({ body, headers: signed(body, { hash: createHash("sha256").update(bad.public_key_base64).digest("hex") }), key: bad }), { ok: false, reason: "bad_key" })
  assert.equal(publicKeyOf(""), null)
})

test("signature: only plain key versions are looked up", () => {
  assert.equal(safeKeyVersion("3"), "3")
  assert.equal(safeKeyVersion("v2.1"), "v2.1")
  assert.equal(safeKeyVersion("../../admin"), null)
  assert.equal(safeKeyVersion(""), null)
})
