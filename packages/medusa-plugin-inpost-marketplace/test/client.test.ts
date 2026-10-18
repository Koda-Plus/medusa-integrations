/**
 * The marketplace clients. The demo client never calls fetch and answers
 * like a seller account; the live client is pending: it never calls fetch
 * either and refuses every method with the polite pending error.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createLiveClient, isPending, maskSecrets, MarketplaceApiPendingError } from "../src/modules/vonhalsky/lib/client.ts"
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

const OFFER = { externalId: "variant_1", sku: "SKU-1", title: "Mug", ean: "5901234123457", brand: "Brand", mpn: null, grossPriceMinor: 4999, currency: "PLN", quantity: 3, images: [], manufacturer: { name: "Maker", email: "maker@example.com", address: "ul. Przykładowa 1, 00-001 Warszawa", phone: null } }

test("demo client: every call works and fetch is never touched", async () => {
  const f = guardFetch()
  try {
    const c = createDemoClient()
    assert.equal(c.mode, "demo")
    assert.equal(c.available, true)
    assert.deepEqual(await c.check(), { ok: true })
    const [a] = await c.upsertOffers([OFFER])
    const [b] = await c.upsertOffers([OFFER])
    assert.equal(a.remoteId, b.remoteId, "a second listing finds the same offer")
    assert.equal(a.remoteId, demoOfferId("variant_1"))
    assert.equal(a.remoteStatus, "PUBLISHED")
    assert.equal((await c.upsertOffers([{ ...OFFER, quantity: 0 }]))[0].remoteStatus, "SOLDOUT")
    await c.closeOffer(a.remoteId)
    assert.deepEqual(await c.listNewOrders(null), { orders: [], cursor: null })
    const order = demoOrder("demo-1", [{ remoteId: a.remoteId, variantId: "variant_1", sku: "SKU-1", ean: OFFER.ean, title: "Mug", priceMinor: 4999, stock: 3 }], 0)!
    assert.equal(await c.getOrder("demo-1"), null)
    c.remember(order)
    assert.equal((await c.getOrder("demo-1"))?.id, "demo-1")
    await c.acceptOrder("demo-1")
    await c.sendTracking("demo-1", ["99123"])
    assert.ok(c.log.some((l) => l.call === "send_tracking"))
    assert.equal(f.calls(), 0)
  } finally {
    f.restore()
  }
})

test("live client: pending, refuses every method politely and never calls fetch", async () => {
  const f = guardFetch()
  try {
    const c = createLiveClient({ mode: "sandbox", apiUrl: "https://sandbox.example.com", organizationId: "org-1", accessToken: "token-abcdefgh" })
    assert.equal(c.available, false)
    const calls: Array<() => Promise<unknown>> = [() => c.check(), () => c.upsertOffers([OFFER]), () => c.closeOffer("x"), () => c.listNewOrders(null), () => c.getOrder("x"), () => c.acceptOrder("x"), () => c.sendTracking("x", ["1"])]
    for (const call of calls) {
      await assert.rejects(call, (e: unknown) => {
        assert.ok(e instanceof MarketplaceApiPendingError)
        assert.ok(isPending(e))
        assert.equal((e as MarketplaceApiPendingError).status, 501)
        assert.match((e as Error).message, /not connected in this version/)
        assert.ok(!(e as Error).message.includes("token-abcdefgh"))
        return true
      })
    }
    assert.equal(f.calls(), 0)
  } finally {
    f.restore()
  }
})

test("secrets are masked in messages", () => {
  assert.equal(maskSecrets("Bearer abc.def.ghi failed", []), "Bearer *** failed")
  assert.equal(maskSecrets("token token-abcdefgh leaked", ["token-abcdefgh"]), "token *** leaked")
})

test("demo order: built from listed offers, sample buyer on example.com, never a real parcel number", () => {
  const offers = [
    { remoteId: "demo-a", variantId: "variant_a", sku: "A", ean: null, title: "A", priceMinor: 1000, stock: 0 },
    { remoteId: "demo-b", variantId: "variant_b", sku: "B", ean: null, title: "B", priceMinor: 2500, stock: 5 },
  ]
  const o = demoOrder("demo-x", offers, 0)!
  assert.equal(o.lines[0].offerId, "demo-b", "offers with stock come first")
  assert.match(o.buyer.email ?? "", /@example\.com$/)
  assert.equal(o.delivery.type, "APM")
  assert.ok(o.delivery.point)
  assert.equal(o.totalMinor, 2500 + o.delivery.priceMinor)
  assert.equal(o.paid, true)
  assert.equal(demoOrder("demo-y", offers, 3)!.paymentType, "CASH_ON_DELIVERY")
  assert.equal(demoOrder("demo-z", offers, 2)!.delivery.type, "COURIER")
  assert.equal(demoOrder("demo-0", [], 0), null)
  const n = demoTrackingNumber("seed")
  assert.match(n, /^99\d{22}$/)
  assert.equal(n, demoTrackingNumber("seed"))
})
