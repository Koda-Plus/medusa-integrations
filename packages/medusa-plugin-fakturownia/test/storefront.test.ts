/**
 * The storefront routes of a logged-in customer: ownership through the
 * order's customer id (never the e-mail), what a customer sees, the PDF
 * through the backend, and the rate limits.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { createRateLimiter } from "../src/modules/fakturownia/lib/rate-limit.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { GET as listRoute } from "../src/api/store/fakturownia/orders/[orderId]/documents/route.ts"
import { GET as pdfRoute } from "../src/api/store/fakturownia/documents/[id]/pdf/route.ts"
import { FakeFakturownia, LIVE, order, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface FakeRes {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  status(code: number): FakeRes
  json(body: unknown): FakeRes
  send(body: unknown): FakeRes
  setHeader(name: string, value: string): void
}

function response(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code
      return res
    },
    json(body) {
      res.body = body
      return res
    },
    send(body) {
      res.body = body
      return res
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value
    },
  }
  return res
}

let customerSeq = 0
const nextCustomer = () => `cus_${++customerSeq}_${Date.now()}`

function request(s: Setup, args: { params: Row; customer?: string | null; actorType?: string; query?: Row }) {
  return {
    scope: s.container,
    params: args.params,
    query: args.query ?? {},
    auth_context: args.customer === null ? undefined : { actor_id: args.customer, actor_type: args.actorType ?? "customer" },
  } as never
}

async function issuedFor(customerId: string, options = LIVE): Promise<{ s: Setup; fake: FakeFakturownia | null }> {
  const s = setup(options, [order({ customer_id: customerId }), order({ id: "order_other", display_id: 1043, customer_id: "cus_someone_else" })])
  const fake = options === LIVE ? new FakeFakturownia() : null
  globalThis.fetch = fake
    ? fake.fetch
    : ((async () => {
        throw new Error("demo mode must not call the network")
      }) as typeof fetch)
  for (const id of [order().id, "order_other"]) await enqueueDue(s.container, id, "payment_captured")
  await issueDue(s.container, "schedule")
  return { s, fake }
}

test("the rate limit: a sliding window per key, with the seconds to wait, and a bounded memory", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, maxKeys: 3 })
  assert.equal(limiter.hit("a", 0).ok, true)
  assert.equal(limiter.hit("a", 1000).ok, true)
  const third = limiter.hit("a", 2000)
  assert.deepEqual([third.ok, third.retryAfterSeconds], [false, 58])
  assert.equal(limiter.hit("a", 60_001).ok, true, "the first hit left the window")
  for (const k of ["b", "c", "d", "e"]) limiter.hit(k, 70_000)
  assert.equal(limiter.size(), 3)
})

test("a customer lists the documents of their own order: what is printed on them and the PDF route", async () => {
  const customer = nextCustomer()
  const { s } = await issuedFor(customer)
  const res = response()
  await listRoute(request(s, { params: { orderId: order().id }, customer }), res as never)
  assert.equal(res.statusCode, 200)
  const body = res.body as { order_id: string; documents: Row[] }
  assert.equal(body.documents.length, 1)
  const doc = body.documents[0]
  assert.deepEqual(Object.keys(doc).sort(), ["corrects", "currency", "id", "issueDate", "kind", "ksefNumber", "number", "paid", "pdfUrl", "totalGross"])
  assert.deepEqual([doc.kind, doc.number, doc.totalGross, doc.paid], ["vat", "FV 1/10/2026", 143, true])
  assert.equal(doc.pdfUrl, `/store/fakturownia/documents/${doc.id}/pdf`)
  assert.equal(res.headers["cache-control"], "private, no-store")
})

test("someone else's order, no customer, or an admin token: nothing", async () => {
  const customer = nextCustomer()
  const { s } = await issuedFor(customer)
  const other = response()
  await listRoute(request(s, { params: { orderId: "order_other" }, customer }), other as never)
  assert.equal(other.statusCode, 404)
  const missing = response()
  await listRoute(request(s, { params: { orderId: "order_missing" }, customer }), missing as never)
  assert.equal(missing.statusCode, 404, "the same answer as someone else's order")
  const anonymous = response()
  await listRoute(request(s, { params: { orderId: order().id }, customer: null }), anonymous as never)
  assert.equal(anonymous.statusCode, 401)
  const admin = response()
  await listRoute(request(s, { params: { orderId: order().id }, customer: "user_1", actorType: "user" }), admin as never)
  assert.equal(admin.statusCode, 401)
})

test("the PDF of one's own document through the backend; someone else's is not found", async () => {
  const customer = nextCustomer()
  const { s, fake } = await issuedFor(customer)
  const own = s.documents.rows.find((r) => r.order_id === order().id)!
  const theirs = s.documents.rows.find((r) => r.order_id === "order_other")!
  const res = response()
  await pdfRoute(request(s, { params: { id: own.id }, customer, query: { download: "1" } }), res as never)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers["content-type"], "application/pdf")
  assert.equal(res.headers["content-disposition"], 'attachment; filename="FV-1-10-2026.pdf"')
  assert.ok(fake!.calls.some((c) => c.path.endsWith(".pdf")))
  const denied = response()
  await pdfRoute(request(s, { params: { id: theirs.id }, customer }), denied as never)
  assert.equal(denied.statusCode, 404)
})

test("ten PDFs a minute per customer", async () => {
  const customer = nextCustomer()
  const { s } = await issuedFor(customer)
  const own = s.documents.rows.find((r) => r.order_id === order().id)!
  const codes: number[] = []
  for (let i = 0; i < 11; i += 1) {
    const res = response()
    await pdfRoute(request(s, { params: { id: own.id }, customer }), res as never)
    codes.push(res.statusCode)
  }
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200))
  assert.equal(codes[10], 429)
})

test("demo: the customer gets the simulated PDF, without a request", async () => {
  const customer = nextCustomer()
  const { s } = await issuedFor(customer, {})
  const own = s.documents.rows.find((r) => r.order_id === order().id)!
  const res = response()
  await pdfRoute(request(s, { params: { id: own.id }, customer }), res as never)
  assert.equal(res.statusCode, 200)
  assert.match((res.body as Buffer).subarray(0, 8).toString("latin1"), /^%PDF-1\.4/)
})
