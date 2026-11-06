/**
 * InPost returns (Returns API): the client against a scripted InPost (the
 * OAuth2 token kept and renewed once after a 401, the create mapped, the
 * label asked as A4 PDF, the secret never in a message), the options, the
 * plan, and the flows end to end: only when allowed and armed, from the plan
 * read, once per order and Medusa return, an unclear answer left `unknown`
 * and never sent again by itself, demo mode without a request.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { InpostApiError } from "../src/modules/inpost/lib/errors.ts"
import { missingReturnOptions, resolveOptions, returnsConfigured } from "../src/modules/inpost/lib/options.ts"
import { buildReturnPlan, e164Phone, expirationFor, toReturnDto } from "../src/modules/inpost/lib/returns.ts"
import { createReturnsClient, describeReturnsError, returnParcelOf } from "../src/modules/inpost/lib/returns-client.ts"
import {
  checkReturnsConnection,
  createReturn,
  ensureDemoReturns,
  planReturn,
  recordMedusaReturn,
  refreshReturn,
  retryReturn,
  returnLabelOf,
  skipReturn,
} from "../src/workflows/inpost/returns.ts"
import { ActionError } from "../src/workflows/inpost/runtime.ts"
import { runSync } from "../src/workflows/inpost/sync.ts"
import { arm, FakeReturns, LIVE, order, RETURNS, RETURNS_ID, RETURNS_ORG, RETURNS_SECRET, setup, type Row } from "./helpers.ts"

const ORDER = "order_01KODASUPPLY000000000001"
const refusal = (code: string) => (e: unknown) => e instanceof ActionError && e.code === code

function client(fake: FakeReturns, now?: () => number) {
  return createReturnsClient({ clientId: RETURNS_ID, clientSecret: RETURNS_SECRET, organizationId: RETURNS_ORG, environment: "stage", timeoutMs: 2000, fetchImpl: fake.fetch as unknown as typeof fetch, now })
}

const BODY = { sender: { firstName: "Anna", lastName: "Nowak", email: "anna.nowak@example.com", phone: "+48000000001" }, references: { orderNumber: "Order 1042" }, enableDropOffCode: true }

/* ------------------------------------------------------------------ */
/* The client                                                          */
/* ------------------------------------------------------------------ */

test("client: the stage and production hosts, one token by Basic auth with the returns scopes, kept until it expires", async () => {
  const fake = new FakeReturns()
  assert.equal(client(fake).host, "https://stage-api.inpost-group.com")
  assert.equal(createReturnsClient({ clientId: "a", clientSecret: "b", organizationId: RETURNS_ORG, environment: "production" }).host, "https://api.inpost-group.com")
  let clock = 1_000_000
  const c = client(fake, () => clock)
  await c.createShipment(BODY)
  await c.createShipment(BODY)
  assert.equal(fake.tokens, 1, "the second call reuses the token")
  const token = fake.calls[0]
  assert.equal(token.url, "https://stage-api.inpost-group.com/oauth2/token")
  assert.equal(token.method, "POST")
  assert.equal(token.contentType, "application/x-www-form-urlencoded")
  assert.equal(token.auth, `Basic ${Buffer.from(`${RETURNS_ID}:${RETURNS_SECRET}`).toString("base64")}`)
  const form = new URLSearchParams(String(token.body))
  assert.equal(form.get("grant_type"), "client_credentials")
  assert.equal(form.get("scope"), "api:returns:read api:returns:write")
  assert.equal(form.get("client_secret"), null, "one method only: the secret is not also in the body")
  /* 599 s, renewed 30 s early. */
  clock += 570_000
  await c.createShipment(BODY)
  assert.equal(fake.tokens, 2)
})

test("client: a 401 of the API gets one new token and one more try, never a loop", async () => {
  const fake = new FakeReturns()
  const c = client(fake)
  fake.expireNext = true
  const s = await c.createShipment(BODY)
  assert.ok(s.id)
  assert.equal(fake.tokens, 2)
  assert.equal(fake.calls.filter((x) => x.url.endsWith("/shipments") && x.method === "POST").length, 2, "the refused try and the one that went through")
  assert.equal(fake.shipments.size, 1, "a 401 is not taken: one return exists")
})

test("client: the create goes to the organization UUID and maps code, numbers and expiry; the label is asked as A4 PDF", async () => {
  const fake = new FakeReturns()
  const c = client(fake)
  const s = await c.createShipment(BODY)
  const post = fake.calls.find((x) => x.method === "POST" && x.url.includes("/returns/"))
  assert.equal(post?.url, `https://stage-api.inpost-group.com/returns/v1/organizations/${RETURNS_ORG}/shipments`)
  assert.deepEqual(post?.body, BODY)
  assert.match(String(post?.auth), /^Bearer /)
  const p = returnParcelOf(s)
  assert.match(String(p.trackingNumber), /^6303\d{20}$/)
  assert.equal(p.shortNumber, "1200 001")
  assert.match(String(p.dropOffCode), /^\d{9}$/)
  assert.equal(p.hasLabel, false)
  const again = await c.getShipment(s.id)
  assert.equal(again.id, s.id)
  const label = await c.getLabel(String(p.trackingNumber))
  assert.equal(label.contentType, "application/pdf")
  const asked = fake.calls.find((x) => x.url.endsWith("/label"))
  assert.equal(asked?.accept, "application/pdf;format=A4")
  assert.equal(asked?.url, `https://stage-api.inpost-group.com/returns/v1/organizations/${RETURNS_ORG}/shipments/${p.trackingNumber}/label`)
  /* Without the code: a label, no code. */
  const label2 = returnParcelOf(await c.createShipment({ ...BODY, enableDropOffCode: false }))
  assert.equal(label2.dropOffCode, null)
  assert.equal(label2.hasLabel, true)
  await assert.rejects(c.getShipment("not-a-uuid"), (e: unknown) => e instanceof InpostApiError && e.code === "bad_id")
})

test("client: an answer that never came is unclear; a refusal and a refused login are not; the secret never shows", async () => {
  const fake = new FakeReturns()
  const c = client(fake)
  fake.failCreate = "timeout"
  const timeout = await c.createShipment(BODY).catch((e) => e)
  assert.equal(timeout.unclear, true)
  assert.equal(timeout.code, "timeout")
  fake.failCreate = "network"
  assert.equal((await c.createShipment(BODY).catch((e) => e)).unclear, true)
  fake.failCreate = { status: 502, body: { message: "gateway" } }
  assert.equal((await c.createShipment(BODY).catch((e) => e)).unclear, true)
  fake.failCreate = { status: 400 }
  const refused = await c.createShipment(BODY).catch((e) => e)
  assert.equal(refused.unclear, false)
  assert.match(describeReturnsError(refused).message, /shipment\.sender\.email: The value has an invalid format/)
  const creates = fake.calls.filter((x) => x.method === "POST" && x.url.includes("/returns/")).length
  assert.equal(creates, 4, "every create was sent once, never retried")
  const other = new FakeReturns()
  other.refuseToken = true
  const login = await client(other).createShipment(BODY).catch((e) => e)
  assert.equal(login.code, "token_refused")
  assert.equal(login.unclear, false, "the create was never sent")
  assert.equal(other.calls.filter((x) => x.url.includes("/returns/")).length, 0)
  for (const err of [timeout, refused, login]) {
    const text = `${err.message} ${describeReturnsError(err).message}`
    assert.ok(!text.includes(RETURNS_SECRET), text)
  }
  /* Even a gateway that echoes the secret back is masked. */
  fake.failCreate = { status: 500, body: { message: `bad client ${RETURNS_SECRET}` } }
  const echoed = await c.createShipment(BODY).catch((e) => e)
  assert.ok(!echoed.message.includes(RETURNS_SECRET))
})

/* ------------------------------------------------------------------ */
/* Options and the plan                                                */
/* ------------------------------------------------------------------ */

test("options: returns configured by id, secret and UUID; stage with sandbox; lenient values with problems", () => {
  const none = resolveOptions({ apiToken: "x", organizationId: "1" })
  assert.equal(none.returns.environment, "production")
  assert.deepEqual(missingReturnOptions(none), ["returnsClientId", "returnsClientSecret", "returnsOrganizationId"])
  assert.equal(returnsConfigured(none), false)
  assert.equal(resolveOptions({ sandbox: true }).returns.environment, "stage")
  assert.equal(resolveOptions({ sandbox: true, returnsEnvironment: "production" }).returns.environment, "production")
  const set = resolveOptions({ ...RETURNS, returnsOrganizationId: RETURNS_ORG.toUpperCase() })
  assert.equal(set.returns.organizationId, RETURNS_ORG)
  assert.equal(returnsConfigured(set), true)
  const bad = resolveOptions({ returnsOrganizationId: "12345", returnsEnvironment: "qa", returnExpirationDays: 3 })
  assert.equal(bad.returns.organizationId, "")
  assert.equal(bad.returns.expirationDays, null)
  assert.ok(bad.problems.some((p) => p.startsWith("returnsOrganizationId")))
  assert.ok(bad.problems.some((p) => p.startsWith("returnsEnvironment")))
  assert.ok(bad.problems.some((p) => p.startsWith("returnExpirationDays")))
  assert.equal(resolveOptions({ returnExpirationDays: "14" }).returns.expirationDays, 14)
  assert.deepEqual(missingReturnOptions(resolveOptions({ demo: true })), [], "demo mode simulates returns")
})

test("the plan: the customer as sender in E.164, the order number, code or label, the expiry for the whole day; problems stop it", () => {
  const o = resolveOptions({ ...LIVE, ...RETURNS, returnExpirationDays: 10 })
  const now = new Date("2026-11-06T09:00:00Z")
  const plan = buildReturnPlan(order() as never, { options: o, demo: false, configured: true, returnId: null, method: "code", now })
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.request, {
    sender: { firstName: "Anna", lastName: "Nowak", email: "anna.nowak@example.com", phone: "+48000000001" },
    origin: { countryCode: "PL" },
    references: { orderNumber: "Order 1042" },
    enableDropOffCode: true,
    expirationDate: "2026-11-16T23:59:59Z",
  })
  assert.equal(plan.destination, "account")
  const noon = buildReturnPlan(order() as never, { options: o, demo: false, configured: true, returnId: null, method: "code", now: new Date("2026-11-06T13:00:00Z") })
  assert.equal(noon.hash, plan.hash, "the same plan all day")
  assert.notEqual(buildReturnPlan(order() as never, { options: o, demo: false, configured: true, returnId: null, method: "label", now }).hash, plan.hash)
  assert.notEqual(buildReturnPlan(order() as never, { options: o, demo: false, configured: true, returnId: "return_1", method: "code", now }).hash, plan.hash, "another Medusa return, another plan")
  const broken = buildReturnPlan(order({ email: null, customer: null, shipping_address: { ...order().shipping_address, phone: "12" } }) as never, { options: o, demo: false, configured: false, returnId: null, method: "code", now })
  assert.equal(broken.ok, false)
  assert.equal(broken.request, null)
  assert.deepEqual(broken.problems.map((p) => p.code), ["return_email_missing", "return_phone_missing", "return_not_configured"])
  assert.equal(e164Phone("+48 000-000-001"), "+48000000001")
  assert.equal(e164Phone("+49 170 1234567"), "+491701234567")
  assert.equal(e164Phone("12"), null)
  assert.equal(expirationFor(null, now), null)
})

/* ------------------------------------------------------------------ */
/* The flows                                                           */
/* ------------------------------------------------------------------ */

async function planned(s: ReturnType<typeof setup>, returnId: string | null = null, method: "code" | "label" = "code") {
  return (await planReturn(s.container, { orderId: ORDER, returnId, method })).plan
}

test("creating needs the writer allowed AND armed, and the hash of the plan read; nothing reaches InPost before", async () => {
  const off = setup({ ...LIVE, ...RETURNS, returnsWriter: false }, [order()])
  await assert.rejects(createReturn(off.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(off)).hash, actor: "user_1" }), refusal("writer_off"))
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  const plan = await planned(s)
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: plan.hash, actor: "user_1" }), refusal("not_armed"))
  await arm(s, "shipment")
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: plan.hash, actor: "user_1" }), refusal("not_armed"), "the shipment writer does not arm returns")
  await arm(s, "returns")
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: null, actor: "user_1" }), refusal("plan_hash_missing"))
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: "0".repeat(24), actor: "user_1" }), refusal("plan_changed"))
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "label", planHash: plan.hash, actor: "user_1" }), refusal("plan_changed"), "the plan read was for a code")
  const unconfigured = setup({ ...LIVE, returnsWriter: true }, [order()])
  await arm(unconfigured, "returns")
  await assert.rejects(createReturn(unconfigured.container, { orderId: ORDER, returnId: null, method: "code", planHash: plan.hash, actor: "user_1" }), refusal("not_configured"))
  for (const x of [off, s, unconfigured]) assert.equal(x.fakeReturns.calls.length, 0)
})

test("created once: the drop-off code, the numbers, the expiry; a second create for the same order answers 409", async () => {
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  await arm(s, "returns")
  const row = await createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" })
  assert.equal(row.state, "created")
  assert.match(String(row.drop_off_code), /^\d{9}$/)
  assert.match(String(row.tracking_number), /^6303\d{20}$/)
  assert.equal(row.short_number, "1200 001")
  assert.equal(row.has_label, false)
  assert.equal(row.method, "code")
  assert.equal(row.reference, "Order 1042")
  assert.equal(row.created_by, "user_1")
  assert.ok(row.expires_at)
  const dto = toReturnDto(row as never)
  assert.equal(dto.trackingUrl, `https://inpost.pl/sledzenie-przesylek?number=${row.tracking_number}`)
  assert.deepEqual(dto.actions, { create: false, refresh: true, label: false, retry: false, skip: false })
  /* No customer data at rest. */
  assert.ok(!JSON.stringify(s.returns.rows).includes("anna.nowak"))
  assert.ok(!JSON.stringify(s.returns.rows).includes("+48000000001"))
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" }), refusal("return_exists"))
  assert.equal(s.fakeReturns.shipments.size, 1)
  assert.equal(s.returns.rows.length, 1)
  /* A drop-off code return has no label. */
  await assert.rejects(returnLabelOf(s.container, row.id), refusal("no_label"))
  /* Reading it again asks InPost for the return by its UUID. */
  const read = await refreshReturn(s.container, row.id)
  assert.equal(read.drop_off_code, row.drop_off_code)
  assert.ok(s.fakeReturns.calls.some((c) => c.method === "GET" && c.url.endsWith(`/shipments/${row.shipment_id}`)))
  assert.ok(s.events.rows.some((e) => e.parcel_id === row.id && e.data?.action === "return_create" && e.data?.outcome === "created"))
})

test("a label return: the PDF through the backend, asked as A4", async () => {
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  await arm(s, "returns")
  const row = await createReturn(s.container, { orderId: ORDER, returnId: null, method: "label", planHash: (await planned(s, null, "label")).hash, actor: "user_1" })
  assert.equal(row.has_label, true)
  assert.equal(row.drop_off_code, null)
  const file = await returnLabelOf(s.container, row.id)
  assert.equal(file.contentType, "application/pdf")
  assert.ok(new TextDecoder().decode(file.data).startsWith("%PDF"))
  assert.equal(s.fakeReturns.calls.find((c) => c.url.endsWith("/label"))?.accept, "application/pdf;format=A4")
})

test("no clear answer: unknown, never sent again by the status pass; Try again only after a person checked", async () => {
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  await arm(s, "returns")
  s.fakeReturns.failCreate = "timeout"
  const row = await createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" })
  assert.equal(row.state, "unknown")
  assert.equal(row.error_code, "timeout")
  const creates = () => s.fakeReturns.calls.filter((c) => c.method === "POST" && c.url.includes("/returns/")).length
  assert.equal(creates(), 1)
  await runSync(s.container, "manual")
  await runSync(s.container, "schedule")
  assert.equal(creates(), 1, "the status pass never sends it again")
  assert.equal(s.returns.rows[0].state, "unknown")
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" }), refusal("return_exists"))
  await assert.rejects(retryReturn(s.container, row.id, "user_1", false), refusal("check_first"))
  const back = await retryReturn(s.container, row.id, "user_1", true)
  assert.equal(back.state, "pending")
  const again = await createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" })
  assert.equal(again.state, "created")
  assert.equal(again.attempts, 2)
  assert.equal(creates(), 2)
})

test("a refusal is failed with InPost's fields, masked; a person may mark it handled instead of trying again", async () => {
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  await arm(s, "returns")
  s.fakeReturns.failCreate = { status: 400 }
  const row = await createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" })
  assert.equal(row.state, "failed")
  assert.match(String(row.error), /sender\.email/)
  assert.ok(!JSON.stringify([...s.returns.rows, ...s.events.rows, ...s.logs]).includes(RETURNS_SECRET))
  const skipped = await skipReturn(s.container, row.id, "user_1")
  assert.equal(skipped.state, "skipped")
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" }), refusal("return_exists"))
})

test("a Medusa return on the InPost return option is recorded pending (nothing sent); another return option is ignored; one row per return", async () => {
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  s.medusaReturns.set("return_01A", { id: "return_01A", order_id: ORDER, fulfillments: [{ id: "ful_r1", provider_id: "inpost_inpost", data: { inpost_return: true, inpost_option: "inpost-zwrot" } }] })
  s.medusaReturns.set("return_01B", { id: "return_01B", order_id: ORDER, fulfillments: [{ id: "ful_r2", provider_id: "manual_manual", data: {} }] })
  const row = await recordMedusaReturn(s.container, ORDER, "return_01A")
  assert.equal(row?.state, "pending")
  assert.equal(row?.return_id, "return_01A")
  assert.equal(await recordMedusaReturn(s.container, ORDER, "return_01B"), null)
  assert.equal((await recordMedusaReturn(s.container, ORDER, "return_01A"))?.id, row?.id)
  assert.equal(s.returns.rows.length, 1)
  assert.equal(s.fakeReturns.calls.length, 0)
  await arm(s, "returns")
  const created = await createReturn(s.container, { orderId: ORDER, returnId: "return_01A", method: "code", planHash: (await planned(s, "return_01A")).hash, actor: "user_1" })
  assert.equal(created.id, row?.id, "the recorded row is the one created")
  assert.equal(created.state, "created")
  /* The order itself may still get its own return, and a return of another order is refused. */
  assert.equal((await createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: (await planned(s)).hash, actor: "user_1" })).state, "created")
  s.medusaReturns.set("return_OTHER", { id: "return_OTHER", order_id: "order_other" })
  await assert.rejects(createReturn(s.container, { orderId: ORDER, returnId: "return_OTHER", method: "code", planHash: (await planned(s, "return_OTHER")).hash, actor: "user_1" }), refusal("return_not_found"))
})

test("demo: simulated returns without a request (a 9 digit code, 24 digits from 6303, 14 days), sample returns once", async () => {
  const s = setup({ demo: true }, [order({ email: null, customer: null })])
  await arm(s, "returns", true)
  const plan = await planned(s)
  assert.equal(plan.ok, true)
  assert.equal(plan.sender.sample, true)
  const row = await createReturn(s.container, { orderId: ORDER, returnId: null, method: "code", planHash: plan.hash, actor: "user_1" })
  assert.equal(row.state, "created")
  assert.equal(row.demo, true)
  assert.match(String(row.drop_off_code), /^\d{9}$/)
  assert.match(String(row.tracking_number), /^6303\d{20}$/)
  const days = (new Date(row.expires_at as string).getTime() - Date.now()) / 86_400_000
  assert.ok(days > 13.9 && days < 14.1, String(days))
  assert.equal(toReturnDto(row as never).trackingUrl, null, "a sample number is never linked to inpost.pl")
  assert.equal(s.fakeReturns.calls.length, 0)
  const check = await checkReturnsConnection(s.container)
  assert.equal(check.ok, true)
  assert.equal(s.fakeReturns.calls.length, 0)
  const orders: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `order_D${i}`, display_id: 3000 + i }))
  const t = setup({ demo: true }, [])
  assert.equal(await ensureDemoReturns(t.container, orders as never), 3)
  assert.equal(await ensureDemoReturns(t.container, orders as never), 0)
  const states = t.returns.rows.map((r) => `${r.state}:${r.method ?? ""}`).sort()
  assert.deepEqual(states, ["created:code", "created:label", "pending:"])
  const label = t.returns.rows.find((r) => r.method === "label") as Row
  const pdf = await returnLabelOf(t.container, label.id)
  assert.match(new TextDecoder().decode(pdf.data), /SIMULATED RETURN LABEL/)
  assert.equal(t.fakeReturns.calls.length, 0)
})

test("Test connection gets a token and nothing else; refused credentials say so, masked", async () => {
  const s = setup({ ...LIVE, ...RETURNS }, [order()])
  const ok = await checkReturnsConnection(s.container)
  assert.equal(ok.ok, true)
  assert.equal(ok.environment, "stage")
  assert.ok((ok.expiresIn ?? 0) > 500)
  assert.deepEqual(s.fakeReturns.calls.map((c) => new URL(c.url).pathname), ["/oauth2/token"])
  const fake = new FakeReturns()
  fake.refuseToken = true
  const bad = await checkReturnsConnection(setup({ ...LIVE, ...RETURNS }, [order()], undefined, fake).container)
  assert.equal(bad.ok, false)
  assert.match(String(bad.error), /refused the Returns API client id or secret/)
  assert.ok(!String(bad.error).includes(RETURNS_SECRET))
})
