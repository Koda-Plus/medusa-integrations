import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { clearIpBlock, ipBlockedUntil, noteIpBlock } from "../src/modules/olx/lib/block.ts"
import { decrypt, encrypt, isValidKey, keyFromBase64 } from "../src/modules/olx/lib/crypto.ts"
import { hasWriteScope, isRequestAllowed, maskSecrets, verifyState, writeKindOf } from "../src/modules/olx/lib/security.ts"

const tokenUrl = "https://www.olx.pl/api/open/oauth/token"
const apiBase = "https://www.olx.pl/api/partner"

test("barrier: reads pass, the token exchange passes, nothing else without a writer", () => {
  assert.equal(isRequestAllowed({ method: "GET", url: `${apiBase}/adverts`, tokenUrl }).ok, true)
  assert.equal(isRequestAllowed({ method: "head", url: `${apiBase}/adverts`, tokenUrl }).ok, true)
  assert.equal(isRequestAllowed({ method: "POST", url: tokenUrl, tokenUrl }).ok, true)
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const v = isRequestAllowed({ method, url: `${apiBase}/adverts/123`, tokenUrl, apiBase })
    assert.equal(v.ok, false, `${method} must be blocked without a writer`)
  }
  assert.equal(isRequestAllowed({ method: "POST", url: `${tokenUrl}?x=1`, tokenUrl }).ok, false)
})

test("barrier: each write needs exactly its own writer armed for the call", () => {
  const command = { method: "POST", url: `${apiBase}/adverts/1012345678/commands`, tokenUrl, apiBase, body: { command: "deactivate", is_success: false } }
  assert.equal(isRequestAllowed({ ...command, allow: ["lifecycle"] }).ok, true)
  assert.equal(isRequestAllowed({ ...command, allow: ["price", "publish"] }).ok, false)
  assert.equal(isRequestAllowed({ ...command }).ok, false)

  const put = { method: "PUT", url: `${apiBase}/adverts/1012345678`, tokenUrl, apiBase, body: { title: "x" } }
  assert.equal(isRequestAllowed({ ...put, allow: ["price"] }).ok, true)
  assert.equal(isRequestAllowed({ ...put, allow: ["lifecycle"] }).ok, false)

  const create = { method: "POST", url: `${apiBase}/adverts`, tokenUrl, apiBase, body: { title: "x" } }
  assert.equal(isRequestAllowed({ ...create, allow: ["publish"] }).ok, true)
  assert.equal(isRequestAllowed({ ...create, allow: ["lifecycle", "price"] }).ok, false)
})

test("barrier: money and deletion stay out of reach even with every writer armed", () => {
  const all = ["lifecycle", "price", "publish"] as const
  const blocked: Array<[string, string, unknown]> = [
    ["DELETE", `${apiBase}/adverts/1012345678`, undefined],
    ["POST", `${apiBase}/adverts/1012345678/commands`, { command: "extend" }],
    ["POST", `${apiBase}/adverts/1012345678/commands`, {}],
    ["POST", `${apiBase}/adverts/1012345678/paid-features`, { code: "pushup" }],
    ["POST", `${apiBase}/adverts/1012345678/packets`, {}],
    ["POST", `${apiBase}/users/me/packets`, {}],
    ["POST", `${apiBase}/threads/abc/messages`, { text: "hi" }],
    ["POST", `${apiBase}/threads/abc/commands`, { command: "mark-as-read" }],
    ["PUT", `${apiBase}/users-business/me`, {}],
    ["POST", `${apiBase}/adverts?external_id=1`, {}],
    ["PUT", `${apiBase}/adverts/abc`, {}],
    ["POST", `https://evil.example.com/api/partner/adverts`, {}],
  ]
  for (const [method, url, body] of blocked) {
    assert.equal(isRequestAllowed({ method, url, tokenUrl, apiBase, body, allow: all }).ok, false, `${method} ${url} must be blocked`)
  }
  assert.equal(writeKindOf("POST", `${apiBase}/adverts/1/commands`, apiBase, { command: "finish" }), "lifecycle")
  assert.equal(writeKindOf("POST", `${apiBase}/adverts/1/commands`, apiBase, { command: "activate" }), "lifecycle")
})

test("IP block: every job of the process waits out the 30 minutes", () => {
  clearIpBlock()
  assert.equal(ipBlockedUntil(1_000), null)
  noteIpBlock(1_000, 30 * 60 * 1000)
  assert.equal(ipBlockedUntil(1_000 + 60_000), 1_000 + 30 * 60 * 1000)
  assert.equal(ipBlockedUntil(1_000 + 30 * 60 * 1000), null, "over at the end of the pause")
  clearIpBlock()
})

test("write scope: read from the granted scope string", () => {
  assert.equal(hasWriteScope("v2 read write"), true)
  assert.equal(hasWriteScope("read+write+v2"), true)
  assert.equal(hasWriteScope("read v2"), false)
  assert.equal(hasWriteScope(null), false)
  assert.equal(hasWriteScope("rewrite"), false)
})

test("masking: literal secrets and long token-like runs, advert URLs survive", () => {
  const secret = "s3cr3t-client-secret"
  const token = "a".repeat(48)
  const out = maskSecrets(
    `secret=${secret} bearer ${token} url=https://www.olx.pl/d/oferta/wkretarka-CID628-ID1bucWN.html id=1012345678`,
    [secret, null],
  )
  assert.ok(!out.includes(secret))
  assert.ok(!out.includes(token))
  assert.ok(out.includes("wkretarka-CID628-ID1bucWN.html"))
  assert.ok(out.includes("1012345678"))
})

test("state: must exist, match literally and not be expired", () => {
  const now = new Date("2026-10-04T12:00:00Z")
  const later = new Date(now.getTime() + 60_000)
  assert.equal(verifyState({ saved: "abc", expiresAt: later, received: "abc", now }).ok, true)
  assert.equal(verifyState({ saved: null, expiresAt: later, received: "abc", now }).ok, false)
  assert.equal(verifyState({ saved: "abc", expiresAt: later, received: "", now }).ok, false)
  assert.equal(verifyState({ saved: "abc", expiresAt: later, received: "abd", now }).ok, false)
  assert.equal(verifyState({ saved: "abc", expiresAt: new Date(now.getTime() - 1), received: "abc", now }).ok, false)
  assert.equal(verifyState({ saved: "abc", expiresAt: "not a date", received: "abc", now }).ok, false)
})

test("AES-256-GCM round trip, tamper detection, key validation", () => {
  const keyText = randomBytes(32).toString("base64")
  const key = keyFromBase64(keyText)
  const stored = encrypt("refresh-token-value", key)
  assert.match(stored, /^v1:[^:]+:[^:]+:[^:]+$/)
  assert.equal(decrypt(stored, key), "refresh-token-value")
  assert.notEqual(encrypt("same", key), encrypt("same", key), "random IV per write")

  const parts = stored.split(":")
  const body = Buffer.from(parts[3], "base64")
  body[0] ^= 1
  const tampered = [parts[0], parts[1], parts[2], body.toString("base64")].join(":")
  assert.throws(() => decrypt(tampered, key))
  assert.throws(() => decrypt(stored, keyFromBase64(randomBytes(32).toString("base64"))))

  assert.equal(isValidKey(keyText), true)
  assert.equal(isValidKey(randomBytes(16).toString("base64")), false)
  assert.equal(isValidKey(""), false)
})
