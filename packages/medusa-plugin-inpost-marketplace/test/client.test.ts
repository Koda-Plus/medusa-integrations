/**
 * The marketplace clients. The demo client never calls fetch and answers
 * like a seller account. The live client speaks the seller API 1.7.6 over
 * the wire of `http.ts` (here a recording fake): the organization in every
 * seller path, returns and refunds on v2, pages of at most 30, offers
 * created in batches of 500, prices and stock in batches of 100, an offer
 * PATCH as a merge patch, a 404 read as "gone", and a check that names an
 * organization the API application does not see. Secrets never reach a
 * message, and the sample orders of the demo use example.com addresses.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { BATCH_OFFERS, BATCH_PRICE_STOCK, createLiveClient, failureText, isApiError, maskSecrets, MarketplaceApiError, money, PAGE_MAX } from "../src/modules/vonhalsky/lib/client.ts"
import type { Http, RequestOptions } from "../src/modules/vonhalsky/lib/http.ts"
import type { OfferProposal } from "../src/modules/vonhalsky/lib/offer-payload.ts"
import { createDemoClient, demoOfferId, demoOrder, demoTrackingNumber } from "../src/modules/vonhalsky/lib/demo.ts"

function guardFetch(): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error("fetch must not be called")
  }) as typeof fetch
  return { calls: () => calls, restore: () => (globalThis.fetch = original) }
}

type Method = Parameters<Http["request"]>[0]
type Call = { method: Method; path: string; opts: RequestOptions }

/** A recording `Http`: every request is kept, the answer comes from `answer`. */
function fakeHttp(answer: (c: Call) => unknown = () => null): { http: Http; calls: Call[] } {
  const calls: Call[] = []
  const http: Http = {
    async request<T = unknown>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
      const c = { method, path, opts }
      calls.push(c)
      return answer(c) as T
    },
    org: (path: string) => path.replace("{org}", "org-1"),
    limits: () => ({ limit: 100, remaining: 99, resetAt: null }),
  }
  return { http, calls }
}

const CONFIG = { mode: "sandbox" as const, apiUrl: "https://api.example.com/inpsa", tokenUrl: "https://auth.example.com/token", clientId: "client-1", clientSecret: "secret-abcdefgh", organizationId: "org-1", timeoutMs: 5000 }
const live = (answer?: (c: Call) => unknown) => {
  const f = fakeHttp(answer)
  return { client: createLiveClient(CONFIG, f.http), calls: f.calls }
}

const PROPOSAL = (externalId: string): OfferProposal => ({
  externalId,
  product: { name: "Mug", description: "A mug.", brand: "Brand", categoryId: "demo-cat-meble", ean: "5901234123457" },
  stock: { quantity: 3, unit: "UNIT" },
  price: { grossPrice: { amount: 49.99, currency: "PLN" }, taxRateInfo: "23%" },
  shippingTime: { daysToShip: 2 },
  images: [{ fileName: "mug.jpg", fileUrl: "https://cdn.example.com/mug.jpg", priority: 1 }],
})

test("demo client: every call works and fetch is never touched", async () => {
  const f = guardFetch()
  try {
    const c = createDemoClient()
    assert.equal(c.mode, "demo")
    assert.equal(c.available, true)
    assert.deepEqual(await c.check(), { ok: true, organization: "Sklep demo" })
    assert.ok((await c.categories()).length > 0)
    assert.ok((await c.categoryAttributes("demo-cat-meble")).length > 0)
    assert.equal((await c.hints({ ean: "5901234123457" })).length, 1)
    const [created] = await c.createOffers([PROPOSAL("variant_1")])
    assert.equal(created.offerId, demoOfferId("variant_1"))
    await c.offerCommand(created.commandId)
    await c.updatePrices([{ offerId: created.offerId, grossPriceMinor: 3999 }])
    await c.updateStocks([{ offerId: created.offerId, quantity: 5 }])
    await c.setPromotion(created.offerId, { start: "2026-10-18T00:00:00Z", end: "2026-10-25T00:00:00Z", mode: "PERCENTAGE", value: 10 })
    await c.deletePromotion(created.offerId)
    await c.setProgram([{ offerId: created.offerId, mode: "IN" }])
    await c.closeOffer(created.offerId)
    await c.reopenOffer(created.offerId)
    assert.ok((await c.offerEvents({ limit: 10 })).length > 0)
    assert.deepEqual(await c.listOrders({ offset: 0, limit: 10 }), { orders: [], total: 0 })
    assert.equal(await c.getOrder("demo-1"), null)
    await c.acceptOrder("demo-1")
    assert.deepEqual(await c.orderEvents({ limit: 10 }), [])
    assert.equal((await c.listReturns({ offset: 0, limit: 10 })).total, 0)
    assert.equal((await c.listRefunds({ offset: 0, limit: 10 })).total, 0)
    assert.equal((await c.listClaims({ offset: 0, limit: 10 })).total, 0)
    assert.ok((await c.dictionaries()).refundReasons.length > 0)
    assert.deepEqual(c.limits(), { limit: null, remaining: null, resetAt: null })
    assert.equal(f.calls(), 0)
  } finally {
    f.restore()
  }
})

test("live client: proves the credentials by finding its organization, and names one it does not see", async () => {
  const ok = live((c) => (c.path === "/v1/organizations" ? [{ id: "org-0", name: "Other" }, { id: "org-1", name: "Sklep testowy" }] : { data: [] }))
  assert.deepEqual(await ok.client.check(), { ok: true, organization: "Sklep testowy" })
  assert.deepEqual(
    ok.calls.map((c) => [c.method, c.path, c.opts.query]),
    [
      ["GET", "/v1/organizations", undefined],
      ["GET", "/v1/organizations/org-1/offers", { limit: 1, offset: 0 }],
    ],
  )
  const other = live((c) => (c.path === "/v1/organizations" ? [{ id: "org-0", name: "Other" }] : { data: [] }))
  await assert.rejects(other.client.check(), (e: unknown) => {
    assert.ok(isApiError(e))
    assert.equal(e.status, 403)
    assert.equal(e.code, "FORBIDDEN")
    assert.match(e.message, /organizationId/)
    return true
  })
  assert.equal(other.calls.length, 1, "nothing else is asked once the organization is missing")
})

test("live client: an offer PATCH is a merge patch on the organization's offer", async () => {
  const { client, calls } = live(() => ({ offer: { id: "off-1", status: "PENDING" } }))
  const offer = await client.patchOffer("off/1", { stock: { quantity: 2, unit: "UNIT" } })
  assert.equal(offer?.id, "off-1")
  assert.equal(calls[0].method, "PATCH")
  assert.equal(calls[0].path, "/v1/organizations/org-1/offers/off%2F1", "ids are encoded")
  assert.equal(calls[0].opts.contentType, "application/merge-patch+json")
  assert.deepEqual(calls[0].opts.body, { stock: { quantity: 2, unit: "UNIT" } })
})

test("live client: offers are created in batches of 500 and the created ids are read", async () => {
  let n = 0
  const { client, calls } = live((c) => (c.opts.body as OfferProposal[]).map((p) => ({ commandId: `cmd-${++n}`, offerId: `off-${n}`, externalId: p.externalId })))
  const proposals = Array.from({ length: BATCH_OFFERS + 1 }, (_, i) => PROPOSAL(`variant_${i}`))
  const created = await client.createOffers(proposals)
  assert.equal(BATCH_OFFERS, 500)
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, (c.opts.body as unknown[]).length]),
    [
      ["POST", "/v1/organizations/org-1/offers/batch", 500],
      ["POST", "/v1/organizations/org-1/offers/batch", 1],
    ],
  )
  assert.equal(created.length, 501)
  assert.deepEqual(created[0], { commandId: "cmd-1", offerId: "off-1", externalId: "variant_0" })
})

test("live client: prices and stock go in batches of 100, as money and whole units", async () => {
  const { client, calls } = live((c) => (c.opts.body as Array<{ offerId: string }>).map((i) => ({ commandId: `cmd-${i.offerId}`, offerId: i.offerId, status: "PENDING" })))
  const prices = Array.from({ length: BATCH_PRICE_STOCK + 50 }, (_, i) => ({ offerId: `off-${i}`, grossPriceMinor: 4999 }))
  const commands = await client.updatePrices(prices)
  assert.equal(commands.length, 150)
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, (c.opts.body as unknown[]).length]),
    [
      ["PATCH", "/v1/organizations/org-1/offers/prices", 100],
      ["PATCH", "/v1/organizations/org-1/offers/prices", 50],
    ],
  )
  assert.deepEqual((calls[0].opts.body as unknown[])[0], { offerId: "off-0", price: { amount: 49.99, currency: "PLN" } })
  calls.length = 0
  await client.updateStocks([
    { offerId: "off-1", quantity: 2.6 },
    { offerId: "off-2", quantity: -4 },
    { offerId: "off-3", quantity: 5_000_000 },
  ])
  assert.equal(calls[0].path, "/v1/organizations/org-1/offers/stocks")
  assert.deepEqual(
    (calls[0].opts.body as Array<{ stock: { quantity: number; unit: string } }>).map((i) => i.stock),
    [
      { quantity: 3, unit: "UNIT" },
      { quantity: 0, unit: "UNIT" },
      { quantity: 999_999, unit: "UNIT" },
    ],
  )
})

test("live client: lists ask for at most 30, newest first, and read the total", async () => {
  const { client, calls } = live(() => ({ data: [{ id: "off-1", status: "PUBLISHED" }, { status: "PUBLISHED" }], page: { limit: 30, offset: 0, total: 77 } }))
  const page = await client.listOffers({ offset: -5, limit: 500, statuses: ["PUBLISHED", "SOLDOUT"] })
  assert.equal(PAGE_MAX, 30)
  assert.deepEqual(calls[0].opts.query, { offset: 0, limit: 30, offerStatus: ["PUBLISHED", "SOLDOUT"], sort: "-updatedAt" })
  assert.equal(page.offers.length, 1, "an offer without an id is skipped")
  assert.equal(page.total, 77)
  calls.length = 0
  await client.listOrders({ offset: 30, limit: 10, updatedSince: "2026-10-18T00:00:00.000Z", paymentStatus: "PAID", statuses: ["ACCEPTED", "CANCELED"] })
  assert.equal(calls[0].path, "/v1/organizations/org-1/orders")
  assert.deepEqual(calls[0].opts.query, { offset: 30, limit: 10, sort: "-updatedAt", updatedAtGte: "2026-10-18T00:00:00.000Z", paymentStatus: "PAID", orderStatus: ["ACCEPTED", "CANCELED"] })
  calls.length = 0
  await client.listOrders({ offset: 0, limit: 10, statuses: [] })
  assert.equal(calls[0].opts.query?.orderStatus, undefined, "no statuses, no filter")
})

test("live client: return statuses go comma-joined in one value", async () => {
  const { client, calls } = live(() => ({ items: [], page: { total: 0 } }))
  await client.listReturns({ offset: 0, limit: 10, status: ["NEW", "ACCEPTED"] })
  await client.listReturns({ offset: 0, limit: 10 })
  assert.equal(calls[0].opts.query?.status, "NEW,ACCEPTED")
  assert.equal(calls[1].opts.query?.status, undefined)
})

test("live client: a price program command is read on its own path, a gone one is null", async () => {
  const { client, calls } = live((c) => (c.path.endsWith("cmd-1") ? { commandId: "cmd-1", status: "SUCCESS" } : null))
  assert.deepEqual(await client.campaignCommand("cmd-1"), { commandId: "cmd-1", offerId: null, status: "SUCCESS", errors: [] })
  assert.equal(await client.campaignCommand("cmd-2"), null)
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, c.opts.notFound]),
    [
      ["GET", "/v1/organizations/org-1/campaigns/commands/cmd-1", "null"],
      ["GET", "/v1/organizations/org-1/campaigns/commands/cmd-2", "null"],
    ],
  )
})

test("live client: a resource that is gone reads as null", async () => {
  const { client, calls } = live(() => null)
  assert.equal(await client.getOffer("off-1"), null)
  assert.equal(await client.getOrder("ord-1"), null)
  assert.equal(await client.offerCommand("cmd-1"), null)
  assert.equal(await client.getReturn("ret-1"), null)
  assert.ok(calls.every((c) => c.opts.notFound === "null"))
})

test("live client: returns and refunds live on v2, claims on v1, a full refund sends no amount", async () => {
  const { client, calls } = live((c) => (c.path.endsWith("/refund") ? { refundId: "ref-1", status: "SUCCESS" } : { items: [], page: { total: 0 } }))
  await client.listReturns({ offset: 0, limit: 10 })
  await client.acceptReturn("ret-1", 2500)
  await client.listClaims({ offset: 0, limit: 10 })
  await client.resolveClaim("ord-1", "clm-1", "partial", "Rabat 20%")
  assert.deepEqual(await client.refundOrder("ord-1", null), { refundId: "ref-1", status: "SUCCESS" })
  await client.refundOrder("ord-1", 1999)
  assert.deepEqual(
    calls.map((c) => [c.method, c.path]),
    [
      ["GET", "/v2/organizations/org-1/returns"],
      ["POST", "/v2/organizations/org-1/returns/ret-1/accept"],
      ["GET", "/v1/organizations/org-1/claims"],
      ["POST", "/v1/organizations/org-1/orders/ord-1/claims/clm-1/partial-refund"],
      ["POST", "/v2/organizations/org-1/orders/ord-1/refund"],
      ["POST", "/v2/organizations/org-1/orders/ord-1/refund"],
    ],
  )
  assert.deepEqual(calls[1].opts.body, { refundAmount: { amount: 25, currency: "PLN" } })
  assert.deepEqual(calls[3].opts.body, { description: "Rabat 20%" })
  assert.deepEqual(calls[4].opts.body, {})
  assert.deepEqual(calls[5].opts.body, { amount: { amount: 19.99, currency: "PLN" } })
})

test("live client: the category tree is read three levels at a time and a deeper branch is fetched", async () => {
  const deep = { id: "c3", name: "Kubki", leaf: false, children: [] }
  const tree = [{ id: "c0", name: "Dom", leaf: false, children: [{ id: "c1", name: "Kuchnia", leaf: false, children: [{ id: "c2", name: "Naczynia", leaf: false, children: [deep] }] }] }]
  const { client, calls } = live((c) => (c.path === "/v1/categories" ? tree : { id: "c3", name: "Kubki", leaf: false, children: [{ id: "c4", name: "Kubki ceramiczne", leaf: true }] }))
  const out = await client.categories()
  assert.deepEqual(
    calls.map((c) => [c.path, c.opts.query]),
    [
      ["/v1/categories", { depth: 3 }],
      ["/v1/categories/c3", { depth: 3 }],
    ],
  )
  const c3 = out[0].children[0].children[0].children[0]
  assert.equal(c3.children[0].id, "c4")
  assert.equal(c3.children[0].leaf, true)
})

test("live client: a branch without children is read again, a read without children makes it a leaf", async () => {
  const tree = [
    { id: "r1", name: "Dom", leaf: false },
    { id: "r2", name: "Moda", leaf: false },
    { id: "r3", name: "Książki", leaf: true },
  ]
  const { client, calls } = live((c) =>
    c.path === "/v1/categories" ? tree : c.path === "/v1/categories/r1" ? { id: "r1", name: "Dom", leaf: false, children: [{ id: "r1a", name: "Kubki", leaf: true }] } : { id: "r2", name: "Moda", leaf: false, children: [] },
  )
  const out = await client.categories()
  assert.deepEqual(calls.map((c) => c.path), ["/v1/categories", "/v1/categories/r1", "/v1/categories/r2"], "even at the first level, and a leaf is never read again")
  assert.equal(out[0].leaf, false)
  assert.equal(out[0].children[0].id, "r1a")
  assert.equal(out[1].leaf, true, "the marketplace has nothing under it")
  assert.equal(out[2].leaf, true)
})

test("live client: past 400 reads a childless branch stays a branch, never offered as a category", async () => {
  const tree = Array.from({ length: 401 }, (_, i) => ({ id: `r${i}`, name: `Kategoria ${i}`, leaf: false }))
  const { client, calls } = live((c) => (c.path === "/v1/categories" ? tree : { id: "x", name: "x", leaf: false, children: [] }))
  const out = await client.categories()
  assert.equal(calls.length, 1 + 400)
  assert.equal(out[399].leaf, true)
  assert.equal(out[400].leaf, false)
  assert.deepEqual(out[400].children, [])
})

test("money: minor units become the API's two decimals", () => {
  assert.deepEqual(money(4999), { amount: 49.99, currency: "PLN" })
  assert.deepEqual(money(100, "eur"), { amount: 1, currency: "EUR" })
})

test("secrets are masked in messages", () => {
  assert.equal(maskSecrets("Bearer abc.def.ghi failed", []), "Bearer *** failed")
  assert.equal(maskSecrets("Basic Y2xpZW50OnNlY3JldA== refused", []), "Basic *** refused")
  assert.equal(maskSecrets("secret secret-abcdefgh leaked", ["secret-abcdefgh"]), "secret *** leaked")
  assert.equal(maskSecrets("short abc stays", ["abc"]), "short abc stays", "values under six characters are not secrets")
  assert.equal(failureText(new MarketplaceApiError(400, "BAD", "InPost Von Halsky answered 400 BAD: name")), "InPost Von Halsky answered 400 BAD: name")
  assert.equal(failureText("plain"), "plain")
})

test("demo order: built from listed offers, sample buyer on example.com, paid through the marketplace", () => {
  const offers = [
    { remoteId: "demo-a", variantId: "variant_a", sku: "A", ean: null, title: "A", priceMinor: 1000, stock: 0 },
    { remoteId: "demo-b", variantId: "variant_b", sku: "B", ean: null, title: "B", priceMinor: 2500, finalPriceMinor: 2000, stock: 5 },
  ]
  const now = new Date("2026-10-18T10:00:00Z")
  const o = demoOrder("demo-x", offers, 0, now)!
  assert.equal(o.lines.length, 1)
  assert.equal(o.lines[0].offerId, "demo-b", "offers with stock come first")
  assert.equal(o.lines[0].unitPriceMinor, 2000, "the buyer pays the final price")
  assert.equal(o.lines[0].basePriceMinor, 2500)
  assert.equal(o.lines[0].promotionPriceMinor, 2000)
  assert.match(o.buyer.email ?? "", /@example\.com$/)
  assert.match(o.delivery.email ?? "", /^demo-[0-9a-f]{8}@example\.com$/)
  assert.equal(o.delivery.type, "APM")
  assert.ok(o.delivery.point)
  assert.deepEqual(o.delivery.parcels, [])
  assert.equal(o.totalMinor, 2000 + o.delivery.priceMinor)
  assert.equal(o.paid, true)
  assert.equal(o.paidAt, now.toISOString())
  assert.equal(o.invoice, null)
  assert.equal(demoOrder("demo-z", offers, 2)!.delivery.type, "COURIER")
  assert.equal(demoOrder("demo-z", offers, 2)!.delivery.point, null)
  const company = demoOrder("demo-c", offers, 4)!
  assert.match(company.invoice?.email ?? "", /@example\.com$/)
  assert.ok(company.invoice?.companyName)
  assert.equal(demoOrder("demo-0", [], 0), null)
  assert.equal(demoOrder("demo-0", [{ ...offers[0], priceMinor: 0 }], 0), null, "an offer without a price is never sold")
})

test("demo order: sometimes two pieces of one offer, sometimes two offers", () => {
  const offers = [
    { remoteId: "demo-a", variantId: "variant_a", sku: "A", ean: null, title: "A", priceMinor: 1000, stock: 3 },
    { remoteId: "demo-b", variantId: "variant_b", sku: "B", ean: null, title: "B", priceMinor: 2500, stock: 5 },
  ]
  const o = demoOrder("demo-1", offers, 1)!
  assert.equal(o.lines.length, 2)
  assert.equal(o.lines[0].quantity, 2)
  assert.equal(o.totalMinor, o.lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0) + o.delivery.priceMinor)
})

test("demo tracking number: the shape of a parcel number, never a real one, the same for the same seed", () => {
  const n = demoTrackingNumber("seed")
  assert.match(n, /^99\d{22}$/)
  assert.equal(n, demoTrackingNumber("seed"))
  assert.notEqual(n, demoTrackingNumber("other seed"))
})
