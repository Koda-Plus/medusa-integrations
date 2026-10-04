import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { decrypt, encrypt, isValidKey, keyFromBase64 } from "../src/modules/olx/lib/crypto.ts"
import { isRequestAllowed, maskSecrets, verifyState } from "../src/modules/olx/lib/security.ts"

const tokenUrl = "https://www.olx.pl/api/open/oauth/token"

test("write barrier: reads pass, the only POST is the token exchange", () => {
  assert.equal(isRequestAllowed({ method: "GET", url: "https://www.olx.pl/api/partner/adverts", tokenUrl }).ok, true)
  assert.equal(isRequestAllowed({ method: "head", url: "https://www.olx.pl/api/partner/adverts", tokenUrl }).ok, true)
  assert.equal(isRequestAllowed({ method: "POST", url: tokenUrl, tokenUrl }).ok, true)
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const v = isRequestAllowed({ method, url: "https://www.olx.pl/api/partner/adverts/123", tokenUrl })
    assert.equal(v.ok, false, `${method} must be blocked`)
  }
  assert.equal(isRequestAllowed({ method: "POST", url: `${tokenUrl}?x=1`, tokenUrl }).ok, false)
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
