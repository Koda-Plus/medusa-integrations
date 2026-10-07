/**
 * The ShipX client against a scripted fetch: the hosts (never api.inpost.pl),
 * the token only in the header and never in a message, reads retried and
 * writes sent once, an unclear write reported as such, the label checked to
 * be a PDF, the paths of the documented endpoints.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createShipxClient } from "../src/modules/inpost/lib/client.ts"
import { describeError, flattenDetails, InpostApiError } from "../src/modules/inpost/lib/errors.ts"
import { FakeShipx, ORG, TOKEN } from "./helpers.ts"

function client(fake: FakeShipx | ((input: unknown, init?: unknown) => Promise<Response>), sandbox = false) {
  const fetchImpl = (fake instanceof FakeShipx ? fake.fetch : fake) as unknown as typeof fetch
  return createShipxClient({ token: TOKEN, organizationId: ORG, sandbox, requestsPerMinute: 60000, timeoutMs: 2000, fetchImpl, sleep: async () => {} })
}

const PAYLOAD = {
  service: "inpost_locker_standard" as const,
  reference: "Order 1042",
  receiver: { email: "anna.nowak@example.com", phone: "000000001" },
  parcels: [{ id: "1", template: "small" as const, weight: { amount: 1, unit: "kg" as const } }],
  custom_attributes: { target_point: "KSP01M" },
}

test("hosts: the ShipX production and sandbox hosts, never api.inpost.pl", async () => {
  const fake = new FakeShipx()
  assert.equal(client(fake).host, "https://api-shipx-pl.easypack24.net")
  assert.equal(client(fake, true).host, "https://sandbox-api-shipx-pl.easypack24.net")
  await client(fake, true).getOrganization()
  assert.equal(fake.calls[0].url, `https://sandbox-api-shipx-pl.easypack24.net/v1/organizations/${ORG}`)
})

test("create: one POST to the organization's shipments with the payload and the Bearer token", async () => {
  const fake = new FakeShipx()
  const s = await client(fake).createShipment(PAYLOAD)
  assert.equal(s.status, "created")
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].method, "POST")
  assert.equal(fake.calls[0].url, `https://api-shipx-pl.easypack24.net/v1/organizations/${ORG}/shipments`)
  assert.equal(fake.calls[0].auth, `Bearer ${TOKEN}`)
  assert.deepEqual(fake.calls[0].body, PAYLOAD)
})

test("a refused create is definite: the fields ShipX names, never retried", async () => {
  const fake = new FakeShipx()
  fake.failCreate = { status: 400 }
  const err = await client(fake).createShipment(PAYLOAD).catch((e) => e)
  assert.ok(err instanceof InpostApiError)
  assert.equal(err.status, 400)
  assert.equal(err.code, "validation_failed")
  assert.equal(err.unclear, false)
  assert.equal(fake.calls.length, 1)
  assert.match(describeError(err).message, /receiver\.phone: invalid/)
})

test("a write without an answer is unclear and never sent twice; a 5xx after a write too", async () => {
  const fake = new FakeShipx()
  fake.failCreate = "timeout"
  const timeout = await client(fake).createShipment(PAYLOAD).catch((e) => e)
  assert.equal(timeout.unclear, true)
  assert.equal(timeout.code, "timeout")
  assert.equal(fake.calls.length, 1)
  fake.failCreate = { status: 502, body: { message: "gateway" } }
  const gateway = await client(fake).createShipment(PAYLOAD).catch((e) => e)
  assert.equal(gateway.unclear, true)
  assert.equal(fake.calls.length, 2)
})

test("reads are retried after a 5xx or a network error, twice at most", async () => {
  let n = 0
  const flaky = async () => {
    n += 1
    if (n < 3) return new Response("oops", { status: 503 })
    return new Response(JSON.stringify({ id: 1, status: "confirmed" }), { status: 200 })
  }
  assert.equal((await client(flaky).getShipment(1)).status, "confirmed")
  assert.equal(n, 3)
  let m = 0
  const down = async () => {
    m += 1
    throw new Error("ECONNRESET")
  }
  await assert.rejects(client(down).getShipment(1), (e: InpostApiError) => e.code === "network")
  assert.equal(m, 3)
})

test("the token never appears in an error, even when ShipX echoes it", async () => {
  const echo = async () => new Response(JSON.stringify({ error: "token_invalid", message: `Bad token ${TOKEN}` }), { status: 401 })
  const err = await client(echo).getShipment(1).catch((e) => e)
  assert.equal(String(err.message).includes(TOKEN), false)
  assert.match(describeError(err).message, /not the Geowidget token/)
})

test("paths: cancel is DELETE /v1/shipments/:id, buy posts the offer id, labels and dispatch orders", async () => {
  const fake = new FakeShipx()
  const c = client(fake)
  const s = await c.createShipment(PAYLOAD)
  await c.cancelShipment(s.id)
  assert.equal(fake.calls.at(-1)?.method, "DELETE")
  assert.equal(fake.calls.at(-1)?.url, `https://api-shipx-pl.easypack24.net/v1/shipments/${s.id}`)
  const s2 = await c.createShipment(PAYLOAD)
  fake.set(String(s2.id), "offers_prepared")
  await c.buyOffer(s2.id, "77")
  assert.deepEqual(fake.calls.at(-1)?.body, { offer_id: 77 })
  assert.match(fake.calls.at(-1)?.url ?? "", /\/v1\/shipments\/\d+\/buy$/)
  const label = await c.getLabel(s2.id, "A6")
  assert.equal(label.contentType, "application/pdf")
  assert.match(fake.calls.at(-1)?.url ?? "", /\/label\?format=pdf&type=A6$/)
  const d = await c.createDispatchOrder({ shipments: [s2.id], name: "Koda Supply", phone: "000000002", address: { street: "ul. Magazynowa", building_number: "1", city: "Warszawa", post_code: "00-001", country_code: "PL" } })
  assert.equal(String(d.id), "77")
  assert.match(fake.calls.at(-1)?.url ?? "", new RegExp(`/v1/organizations/${ORG}/dispatch_orders$`))
  const found = await c.findShipments({ receiver_email: "anna.nowak@example.com", created_at_gteq: "2026-10-07T00:00:00.000Z" })
  assert.equal(found.length, 2)
  assert.match(fake.calls.at(-1)?.url ?? "", /receiver_email=anna\.nowak%40example\.com/)
})

test("a label before payment is refused by ShipX; something that is not a PDF is never passed on", async () => {
  const fake = new FakeShipx()
  const c = client(fake)
  const s = await c.createShipment(PAYLOAD)
  await assert.rejects(c.getLabel(s.id, "normal"), (e: InpostApiError) => e.code === "invalid_action")
  const html = async () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })
  await assert.rejects(client(html).getLabel(1, "A6"), (e: InpostApiError) => e.code === "label_not_pdf")
})

test("ids are checked before a request: a shipment id has digits only, the organization too", async () => {
  const fake = new FakeShipx()
  await assert.rejects(client(fake).getShipment("1; DROP"), (e: InpostApiError) => e.code === "bad_id")
  const noOrg = createShipxClient({ token: TOKEN, organizationId: "", fetchImpl: fake.fetch as unknown as typeof fetch, sleep: async () => {} })
  await assert.rejects(noOrg.createShipment(PAYLOAD), (e: InpostApiError) => e.code === "not_configured")
  assert.equal(fake.calls.length, 0)
  assert.deepEqual(flattenDetails({ receiver: { phone: ["invalid"], email: ["required"] }, parcels: [{ template: ["invalid"] }] }), ["receiver.phone: invalid", "receiver.email: required", "parcels.template: invalid"])
})
