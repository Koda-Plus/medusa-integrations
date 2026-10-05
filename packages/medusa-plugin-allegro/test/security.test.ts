import { test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { allegroUrls } from "../src/modules/allegro/lib/constants.ts"
import { decrypt, encrypt, isValidKey, keyFromBase64 } from "../src/modules/allegro/lib/crypto.ts"
import { isRequestAllowed, maskSecrets } from "../src/modules/allegro/lib/security.ts"

const urls = allegroUrls("production")
const oauthUrls = [urls.device, urls.token]

test("write barrier: reads pass, the only POSTs go to the OAuth server", () => {
  assert.equal(isRequestAllowed({ method: "GET", url: `${urls.api}/sale/offers?limit=1000`, oauthUrls }).ok, true)
  assert.equal(isRequestAllowed({ method: "head", url: `${urls.api}/sale/offers`, oauthUrls }).ok, true)
  assert.equal(isRequestAllowed({ method: "POST", url: urls.token, oauthUrls }).ok, true)
  /* The device request carries client_id in the query; the address itself is what counts. */
  assert.equal(isRequestAllowed({ method: "POST", url: `${urls.device}?client_id=abc`, oauthUrls }).ok, true)
})

test("write barrier: every write to the REST API is blocked, whatever the verb", () => {
  const targets = [
    `${urls.api}/sale/product-offers/123`,
    `${urls.api}/sale/offer-quantity-change-commands/0f8b4c56-7e1a-4c3e-9a51-0123456789ab`,
    `${urls.api}/order/checkout-forms/0f8b4c56-7e1a-4c3e-9a51-0123456789ab/fulfillment`,
  ]
  for (const url of targets) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(isRequestAllowed({ method, url, oauthUrls }).ok, false, `${method} ${url} must be blocked`)
    }
  }
  /* A token endpoint of another host is not ours. */
  assert.equal(isRequestAllowed({ method: "POST", url: "https://evil.example/auth/oauth/token", oauthUrls }).ok, false)
})

test("sandbox and production have separate OAuth and API hosts", () => {
  const sandbox = allegroUrls("sandbox")
  assert.notEqual(sandbox.token, urls.token)
  assert.ok(sandbox.api.includes("allegrosandbox"))
  assert.equal(urls.link, "https://allegro.pl/skojarz-aplikacje")
})

test("masking: literal secrets and long token-like runs, offer and order ids survive", () => {
  const secret = "s3cr3t-client-secret"
  const jwtPart = "eyJ" + "a".repeat(60)
  const out = maskSecrets(
    `secret=${secret} bearer ${jwtPart}.${"b".repeat(50)} offer=17123456789 order=0f8b4c56-7e1a-4c3e-9a51-0123456789ab`,
    [secret, null],
  )
  assert.ok(!out.includes(secret))
  assert.ok(!out.includes(jwtPart))
  assert.ok(out.includes("17123456789"))
  assert.ok(out.includes("0f8b4c56-7e1a-4c3e-9a51-0123456789ab"))
})

test("encryption: round trip, random IV, wrong key and tampering fail", () => {
  const keyText = randomBytes(32).toString("base64")
  const key = keyFromBase64(keyText)
  const a = encrypt("refresh-token-value", key)
  const b = encrypt("refresh-token-value", key)
  assert.notEqual(a, b)
  assert.equal(decrypt(a, key), "refresh-token-value")
  assert.throws(() => decrypt(a, keyFromBase64(randomBytes(32).toString("base64"))))
  const parts = a.split(":")
  parts[3] = Buffer.from("tampered").toString("base64")
  assert.throws(() => decrypt(parts.join(":"), key))
  assert.equal(isValidKey(keyText), true)
  assert.equal(isValidKey(randomBytes(16).toString("base64")), false)
})
