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

const uuid = "0f8b4c56-7e1a-4c3e-9a51-0123456789ab"
const allow = (method: string, path: string, writer: string | null, armed: string[], body?: unknown) =>
  isRequestAllowed({ method, url: `${urls.api}${path}`, oauthUrls, apiBase: urls.api, writer, armed: new Set(armed), body }).ok

test("allowlist: an armed writer may call exactly its own paths", () => {
  assert.equal(allow("PUT", `/sale/offer-quantity-change-commands/${uuid}`, "stock", ["stock"], { modification: { changeType: "FIXED", value: 3 } }), true)
  assert.equal(allow("PUT", `/sale/offer-publication-commands/${uuid}`, "stock", ["stock"], { publication: { action: "END" } }), true)
  assert.equal(allow("PUT", `/sale/offer-price-change-commands/${uuid}`, "prices", ["prices"], { modification: { type: "FIXED_PRICE" } }), true)
  assert.equal(allow("POST", `/order/checkout-forms/${uuid}/shipments`, "shipping", ["shipping"]), true)
  assert.equal(allow("PUT", `/order/checkout-forms/${uuid}/fulfillment`, "shipping", ["shipping"], { status: "SENT" }), true)
  assert.equal(allow("POST", `/order/${uuid}/billing-documents/files`, "invoices", ["invoices"]), true)
  assert.equal(allow("POST", "/sale/product-offers", "publish", ["publish"], { publication: { status: "INACTIVE" } }), true)
})

test("allowlist: a disarmed writer, another writer's path or no writer at all is blocked", () => {
  assert.equal(allow("PUT", `/sale/offer-quantity-change-commands/${uuid}`, "stock", [], { modification: { changeType: "FIXED", value: 3 } }), false)
  assert.equal(allow("PUT", `/sale/offer-quantity-change-commands/${uuid}`, "prices", ["prices", "stock"], { modification: { changeType: "FIXED", value: 3 } }), false)
  assert.equal(allow("POST", `/order/checkout-forms/${uuid}/shipments`, null, ["shipping"]), false)
  assert.equal(allow("POST", `/order/checkout-forms/${uuid}/shipments`, "orders", ["orders"]), false)
  assert.equal(allow("DELETE", `/order/checkout-forms/${uuid}/shipments`, "shipping", ["shipping"]), false)
  assert.equal(allow("PATCH", `/sale/product-offers/123`, "publish", ["publish"], { publication: { status: "INACTIVE" } }), false)
})

test("allowlist: the body rules close what a path cannot", () => {
  /* Never ACTIVATE an offer, never a quantity of zero or a relative change. */
  assert.equal(allow("PUT", `/sale/offer-publication-commands/${uuid}`, "stock", ["stock"], { publication: { action: "ACTIVATE" } }), false)
  assert.equal(allow("PUT", `/sale/offer-quantity-change-commands/${uuid}`, "stock", ["stock"], { modification: { changeType: "FIXED", value: 0 } }), false)
  assert.equal(allow("PUT", `/sale/offer-quantity-change-commands/${uuid}`, "stock", ["stock"], { modification: { changeType: "GAIN", value: 5 } }), false)
  /* A new offer is a draft or nothing. */
  assert.equal(allow("POST", "/sale/product-offers", "publish", ["publish"], { publication: { status: "ACTIVE" } }), false)
  assert.equal(allow("POST", "/sale/product-offers", "publish", ["publish"], {}), false)
  /* The shipping writer sets only the two forward statuses. */
  assert.equal(allow("PUT", `/order/checkout-forms/${uuid}/fulfillment`, "shipping", ["shipping"], { status: "CANCELLED" }), false)
})

test("allowlist: another host, a path suffix or a query string is blocked", () => {
  const evil = isRequestAllowed({ method: "POST", url: `https://api.evil.example/order/checkout-forms/${uuid}/shipments`, oauthUrls, apiBase: urls.api, writer: "shipping", armed: new Set(["shipping"]) })
  assert.equal(evil.ok, false)
  assert.equal(allow("POST", `/order/checkout-forms/${uuid}/shipments/extra`, "shipping", ["shipping"]), false)
  assert.equal(allow("POST", `/order/checkout-forms/${uuid}/shipments?x=1`, "shipping", ["shipping"]), false)
  assert.equal(allow("PUT", `/order/checkout-forms/${uuid}/fulfillment?checkoutForm.revision=819b5836`, "shipping", ["shipping"], { status: "SENT" }), true)
  assert.equal(allow("PUT", `/order/checkout-forms/${uuid}/fulfillment?checkoutForm.revision=819b5836&x=1`, "shipping", ["shipping"], { status: "SENT" }), false)
  assert.equal(allow("PUT", `/sale/offer-quantity-change-commands/not-a-uuid`, "stock", ["stock"], { modification: { changeType: "FIXED", value: 1 } }), false)
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
