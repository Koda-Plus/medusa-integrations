/**
 * The simulated marketplace of demo mode behaves like the seller API in the
 * ways the flows depend on: writes are commands that stay PENDING until
 * they are read, an offer without an image or a description (or outside a
 * leaf category) stays PENDING with validation codes, prices follow the
 * promotion and the price program, events are kept newest first and paged
 * backwards, a simulated order takes stock (sold out at zero), parcels,
 * returns, claims and refunds appear where the panel reads them; a
 * published offer refuses a change other than price and stock (close it
 * first); one offer of "another tool" waits for "Import from InPost".
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDemoClient, demoOfferId, demoOrder, type DemoClient } from "../src/modules/vonhalsky/lib/demo.ts"
import type { OfferProposal } from "../src/modules/vonhalsky/lib/offer-payload.ts"
import type { MarketplaceOrder } from "../src/modules/vonhalsky/lib/client.ts"
import type { RemoteClaim, RemoteReturn } from "../src/modules/vonhalsky/lib/remote.ts"

const proposal = (externalId: string, over: Partial<OfferProposal> = {}, product: Partial<OfferProposal["product"]> = {}): OfferProposal => ({
  externalId,
  product: { name: "Ceramic mug", description: "A mug.", brand: "Brand", categoryId: "demo-cat-meble", ean: "5901234123457", ...product },
  stock: { quantity: 3, unit: "UNIT" },
  price: { grossPrice: { amount: 100, currency: "PLN" }, taxRateInfo: "23%" },
  shippingTime: { daysToShip: 2 },
  images: [{ fileName: "mug.jpg", fileUrl: "https://cdn.example.com/mug.jpg", priority: 1 }],
  ...over,
})

/** Lists one offer and reads its command, as the sync does. */
async function listed(c: DemoClient, p: OfferProposal): Promise<string> {
  const [created] = await c.createOffers([p])
  await c.offerCommand(created.commandId)
  return created.offerId
}

/** A simulated order of one piece of the offer. */
function orderOf(offerId: string, id = "demo-order-1", stock = 1): MarketplaceOrder {
  const o = demoOrder(id, [{ remoteId: offerId, variantId: "variant_1", sku: "SKU-1", ean: null, title: "Ceramic mug", priceMinor: 10_000, stock }], 0, new Date("2026-10-18T10:00:00Z"))
  assert.ok(o)
  return o
}

test("offers: a listed offer is PENDING until its command is read, then PUBLISHED", async () => {
  const c = createDemoClient()
  const [created] = await c.createOffers([proposal("variant_1")])
  assert.equal(created.offerId, demoOfferId("variant_1"))
  assert.equal(created.externalId, "variant_1")
  assert.equal((await c.getOffer(created.offerId))?.status, "PENDING")
  const read = await c.offerCommand(created.commandId)
  assert.deepEqual(read, { commandId: created.commandId, offerId: created.offerId, status: "SUCCESS", errors: [] })
  const offer = await c.getOffer(created.offerId)
  assert.equal(offer?.status, "PUBLISHED")
  assert.equal(offer?.stock, 3)
  assert.equal(offer?.grossPriceMinor, 10_000)
  assert.deepEqual(offer?.validationErrors, [])
  assert.deepEqual(
    (await c.offerEvents({ limit: 10 })).map((e) => e.type),
    ["PUBLISHED", "CREATED"],
    "newest first",
  )
  assert.equal(await c.offerCommand("demo-cmd-unknown"), null)
})

test("offers: an offer listed without stock is sold out", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1", { stock: { quantity: 0, unit: "UNIT" } }))
  assert.equal((await c.getOffer(id))?.status, "SOLDOUT")
})

test("offers: listing the same variant again finds the same offer", async () => {
  const c = createDemoClient()
  const first = await listed(c, proposal("variant_1"))
  const [again] = await c.createOffers([proposal("variant_1")])
  assert.equal(again.offerId, first)
  assert.equal((await c.listOffers({ offset: 0, limit: 30 })).total, 1)
})

test("validation: an offer without images or a description stays PENDING with the marketplace's codes", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1", { images: [] }, { description: " " }))
  const offer = await c.getOffer(id)
  assert.equal(offer?.status, "PENDING")
  assert.deepEqual(
    offer?.validationErrors.map((v) => v.code),
    ["IMAGES_REQUIRED", "DESCRIPTION_REQUIRED"],
  )
  assert.ok(offer?.validationErrors.every((v) => v.message))
  assert.equal((await c.offerEvents({ limit: 1 }))[0].type, "VALIDATION_FAILED")
  assert.deepEqual((await c.listOffers({ offset: 0, limit: 30, statuses: ["PENDING"] })).offers.map((o) => o.id), [id])
})

test("validation: a category that is not a leaf is refused", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1", {}, { categoryId: "demo-cat-dom" }))
  assert.deepEqual((await c.getOffer(id))?.validationErrors.map((v) => v.code), ["CATEGORY_NOT_LEAF"])
})

test("validation: patching the missing image and description publishes a pending offer", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1", { images: [] }, { description: "" }))
  const patched = await c.patchOffer(id, { images: [{ fileName: "mug.jpg", fileUrl: "https://cdn.example.com/mug.jpg", priority: 1 }], product: { description: "A mug." } })
  assert.equal(patched?.status, "PUBLISHED")
  assert.deepEqual(patched?.validationErrors, [])
  assert.equal(patched?.imageCount, 1)
  assert.equal(await c.patchOffer("demo-unknown", { stock: { quantity: 1, unit: "UNIT" } }), null)
})

test("prices: a price update waits for its command, the promotion and the price program lower the final price", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const [price] = await c.updatePrices([{ offerId: id, grossPriceMinor: 20_000 }])
  assert.equal(price.status, "PENDING")
  assert.equal((await c.getOffer(id))?.grossPriceMinor, 10_000, "nothing changes before the command is read")
  await c.offerCommand(price.commandId)
  assert.equal((await c.getOffer(id))?.grossPriceMinor, 20_000)
  const promo = await c.setPromotion(id, { start: "2026-01-01T00:00:00Z", end: "2099-01-01T00:00:00Z", mode: "PERCENTAGE", value: 10 })
  await c.offerCommand(promo!.commandId)
  let offer = await c.getOffer(id)
  assert.equal(offer?.promotion?.status, "ACTIVE")
  assert.equal(offer?.promotionPriceMinor, 18_000)
  assert.equal(offer?.finalPriceMinor, 18_000)
  const [program] = await c.setProgram([{ offerId: id, mode: "IN" }])
  await c.offerCommand(program.commandId)
  offer = await c.getOffer(id)
  assert.equal(offer?.program, "IN")
  assert.equal(offer?.finalPriceMinor, 17_100, "the program takes 5% off the promotion price")
  const off = await c.deletePromotion(id)
  await c.offerCommand(off!.commandId)
  assert.equal((await c.getOffer(id))?.finalPriceMinor, 19_000)
})

test("commands: a price program declaration waits for its command, read on the campaign path", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const [cmd] = await c.setProgram([{ offerId: id, mode: "IN" }])
  assert.equal(cmd.status, "PENDING")
  assert.equal((await c.getOffer(id))?.program, null)
  const read = await c.campaignCommand(cmd.commandId)
  assert.equal(read?.status, "SUCCESS")
  assert.equal((await c.getOffer(id))?.program, "IN")
  assert.deepEqual(await c.campaignCommand(cmd.commandId), read, "a second read changes nothing")
  assert.equal(await c.campaignCommand("demo-cmd-unknown"), null)
})

test("commands: an update of an offer the marketplace does not know fails when read", async () => {
  const c = createDemoClient()
  const [cmd] = await c.updateStocks([{ offerId: "demo-unknown", quantity: 2 }])
  assert.equal(cmd.status, "PENDING")
  const read = await c.offerCommand(cmd.commandId)
  assert.equal(read?.status, "FAILURE")
  assert.deepEqual(read?.errors, [{ field: null, message: "Offer not found" }])
  assert.equal(await c.closeOffer("demo-unknown"), null)
})

test("stock: zero sells the offer out, stock coming back publishes it again", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const [zero] = await c.updateStocks([{ offerId: id, quantity: 0 }])
  await c.offerCommand(zero.commandId)
  assert.equal((await c.getOffer(id))?.status, "SOLDOUT")
  const [back] = await c.updateStocks([{ offerId: id, quantity: 4 }])
  await c.offerCommand(back.commandId)
  assert.equal((await c.getOffer(id))?.status, "PUBLISHED")
  assert.equal((await c.getOffer(id))?.stock, 4)
})

test("close and reopen: each waits for its command", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const close = await c.closeOffer(id)
  assert.equal((await c.getOffer(id))?.status, "PUBLISHED")
  await c.offerCommand(close!.commandId)
  assert.equal((await c.getOffer(id))?.status, "CLOSED")
  const reopen = await c.reopenOffer(id)
  await c.offerCommand(reopen!.commandId)
  assert.equal((await c.getOffer(id))?.status, "PUBLISHED")
})

test("events: newest first, paged backwards from the last one seen", async () => {
  const c = createDemoClient()
  await listed(c, proposal("variant_1"))
  await listed(c, proposal("variant_2"))
  const all = await c.offerEvents({ limit: 100 })
  assert.equal(all.length, 4)
  assert.deepEqual(
    all.map((e) => [e.externalId, e.type]),
    [
      ["variant_2", "PUBLISHED"],
      ["variant_2", "CREATED"],
      ["variant_1", "PUBLISHED"],
      ["variant_1", "CREATED"],
    ],
  )
  const first = await c.offerEvents({ limit: 2 })
  assert.deepEqual(first.map((e) => e.id), all.slice(0, 2).map((e) => e.id))
  const next = await c.offerEvents({ limit: 2, untilId: first[1].id })
  assert.deepEqual(next.map((e) => e.id), all.slice(2, 4).map((e) => e.id))
  assert.deepEqual(await c.offerEvents({ limit: 2, untilId: all[3].id }), [], "nothing older than the oldest")
})

test("events: an unknown untilId pages nothing instead of starting over", async () => {
  const c = createDemoClient()
  await listed(c, proposal("variant_1"))
  assert.deepEqual(await c.offerEvents({ limit: 10, untilId: "demo-ev-unknown" }), [])
})

test("orders: a remembered order emits its events newest first and takes stock, sold out at zero", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1", { stock: { quantity: 1, unit: "UNIT" } }))
  const order = orderOf(id)
  c.remember(order)
  assert.deepEqual(
    (await c.orderEvents({ limit: 10 })).map((e) => [e.subjectId, e.type]),
    [
      ["demo-order-1", "PAID"],
      ["demo-order-1", "CREATED"],
    ],
  )
  const offer = await c.getOffer(id)
  assert.equal(offer?.stock, 0)
  assert.equal(offer?.status, "SOLDOUT")
  assert.equal((await c.offerEvents({ limit: 1 }))[0].type, "SOLDOUT")
  assert.equal((await c.getOrder("demo-order-1"))?.id, "demo-order-1")
})

test("orders: an unpaid order has no payment event, and the list filters by payment", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  c.remember(orderOf(id, "demo-paid", 3))
  c.remember({ ...orderOf(id, "demo-unpaid", 3), paid: false, paidAt: null })
  const events = await c.orderEvents({ limit: 10 })
  assert.deepEqual(events.filter((e) => e.subjectId === "demo-unpaid").map((e) => e.type), ["CREATED"])
  assert.deepEqual((await c.listOrders({ offset: 0, limit: 30, paymentStatus: "NOT_PAID" })).orders.map((o) => o.id), ["demo-unpaid"])
  assert.deepEqual((await c.listOrders({ offset: 0, limit: 30, paymentStatus: "PAID" })).orders.map((o) => o.id), ["demo-paid"])
  assert.equal((await c.getOffer(id))?.stock, 1, "both orders took a piece")
})

test("orders: a parcel appears once on the order, with a shipping event and an expected delivery", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  c.remember(orderOf(id, "demo-order-1", 3))
  assert.equal(c.addParcel("demo-order-1", "990000000000000000000001"), true)
  assert.equal(c.addParcel("demo-order-1", "990000000000000000000001"), true)
  const order = await c.getOrder("demo-order-1")
  assert.deepEqual(order?.delivery.parcels.map((p) => p.trackingNumber), ["990000000000000000000001"])
  assert.ok(order?.delivery.expectedAt)
  assert.deepEqual((await c.orderEvents({ limit: 10 })).filter((e) => e.type === "SHIPPED").length, 1)
  assert.equal(c.addParcel("demo-unknown", "990000000000000000000002"), false)
})

test("orders: the list keeps only the asked statuses", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  c.remember(orderOf(id, "demo-accepted", 3))
  c.remember({ ...orderOf(id, "demo-cancelled", 3), status: "CANCELED" })
  assert.deepEqual((await c.listOrders({ offset: 0, limit: 30, statuses: ["ACCEPTED"] })).orders.map((o) => o.id), ["demo-accepted"])
})

test("returns: a simulated return is NEW in the list, newest first, with a return event", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  c.remember(orderOf(id, "demo-order-1", 3))
  const first = c.simulateCase("return", "demo-order-1", 0) as RemoteReturn
  const second = c.simulateCase("return", "demo-order-1", 1) as RemoteReturn
  assert.equal(first.status, "NEW")
  assert.equal(first.orderId, "demo-order-1")
  assert.equal(first.lines[0].offerId, id)
  assert.equal(first.refundMinor, 10_000)
  const list = await c.listReturns({ offset: 0, limit: 10 })
  assert.equal(list.total, 2)
  assert.deepEqual(list.returns.map((r) => r.id), [second.id, first.id])
  assert.equal((await c.listReturns({ offset: 0, limit: 10, status: ["ACCEPTED"] })).total, 0)
  assert.equal((await c.orderEvents({ limit: 1 }))[0].type, "RETURN_CREATED")
  assert.equal(c.simulateCase("return", "demo-unknown", 0), null)
})

test("claims: a simulated claim is open in the list until it is resolved", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  c.remember(orderOf(id, "demo-order-1", 3))
  const claim = c.simulateCase("claim", "demo-order-1", 1) as RemoteClaim
  assert.equal(claim.state, "RESOLUTION_IN_PROGRESS")
  assert.equal(claim.resolution, null)
  assert.equal(claim.requested, "PARTIAL_REFUND")
  assert.equal(claim.partialPercent, 20)
  const list = await c.listClaims({ offset: 0, limit: 10 })
  assert.deepEqual(list.claims.map((x) => x.id), [claim.id])
  await c.resolveClaim("demo-order-1", claim.id, "reject", null)
  const rejected = await c.getClaim("demo-order-1", claim.id)
  assert.equal(rejected?.state, "REJECTED")
  assert.equal(rejected?.resolution, "REJECTED")
  assert.equal((await c.listRefunds({ offset: 0, limit: 10 })).total, 0, "a rejected claim refunds nothing")
})

test("refunds: an accepted return refunds part of the order, a full refund of the rest says REFUNDED", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const order = orderOf(id, "demo-order-1", 3)
  c.remember(order)
  const ret = c.simulateCase("return", "demo-order-1", 0) as RemoteReturn
  const accepted = await c.acceptReturn(ret.id, 2500)
  assert.ok(accepted.refundId)
  const after = await c.getReturn(ret.id)
  assert.equal(after?.status, "ACCEPTED")
  assert.equal(after?.refundId, accepted.refundId)
  assert.equal(after?.refundPaymentStatus, "REFUNDED")
  assert.deepEqual(await c.acceptReturn(ret.id, 2500), { refundId: null }, "a decided return is not refunded twice")
  assert.equal((await c.orderEvents({ limit: 1 }))[0].type, "PARTIALLY_REFUNDED")
  const rest = await c.refundOrder("demo-order-1", (order.totalMinor ?? 0) - 2500)
  assert.equal(rest.status, "SUCCESS")
  assert.equal((await c.orderEvents({ limit: 1 }))[0].type, "REFUNDED")
  const refunds = await c.listRefunds({ offset: 0, limit: 10 })
  assert.equal(refunds.total, 2)
  assert.deepEqual(refunds.refunds.map((r) => [r.source, r.amountMinor]), [
    ["INDEPENDENT", (order.totalMinor ?? 0) - 2500],
    ["RETURN", 2500],
  ])
  assert.deepEqual(await c.refundOrder("demo-unknown", null), { refundId: null, status: null })
})

test("refunds: a partial claim refunds its percent of the claimed product, a full refund without an amount the whole order", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const order = orderOf(id, "demo-order-1", 3)
  c.remember(order)
  const claim = c.simulateCase("claim", "demo-order-1", 1) as RemoteClaim
  await c.resolveClaim("demo-order-1", claim.id, "partial", "Rabat")
  assert.equal((await c.getClaim("demo-order-1", claim.id))?.resolution, "PARTIAL_REFUND")
  const [partial] = (await c.listRefunds({ offset: 0, limit: 10 })).refunds
  assert.equal(partial.source, "CLAIM")
  assert.equal(partial.amountMinor, 2000)
  const other = createDemoClient()
  const otherId = await listed(other, proposal("variant_1"))
  other.remember(orderOf(otherId, "demo-order-2", 3))
  const full = await other.refundOrder("demo-order-2", null)
  assert.ok(full.refundId)
  assert.equal((await other.getRefund(full.refundId!))?.amountMinor, order.totalMinor)
  assert.equal((await other.orderEvents({ limit: 1 }))[0].type, "REFUNDED")
})

test("catalog: a small Polish category tree, attributes of leaves only, a hint for an EAN", async () => {
  const c = createDemoClient()
  const tree = await c.categories()
  assert.ok(tree.every((root) => !root.leaf && root.children.every((leaf) => leaf.leaf)))
  assert.ok(tree.some((root) => root.gpsrFree), "a branch outside GPSR")
  assert.ok((await c.categoryAttributes("demo-cat-meble")).some((a) => a.required))
  assert.deepEqual(await c.categoryAttributes("demo-cat-dom"), [])
  const [hint] = await c.hints({ ean: "5901234123457", name: "Kubek" })
  assert.equal(hint.ean, "5901234123457")
  assert.ok(tree.flatMap((r) => r.children).some((l) => l.id === hint.categoryId), "the hint names a leaf")
  assert.deepEqual(await c.hints({ name: "Kubek" }), [], "a name alone is not enough")
})

test("edits: a published offer refuses a change other than price and stock, a closed one takes it when the command is read", async () => {
  const c = createDemoClient()
  const id = await listed(c, proposal("variant_1"))
  const refused = await c.updateOffer(id, { product: { name: "Kubek emaliowany niebieski" } })
  assert.equal(refused.offer, null)
  const read = await c.offerCommand(refused.command!.commandId)
  assert.equal(read?.status, "FAILURE", "as InPost's FAQ warns")
  assert.equal((await c.getOffer(id))?.name, "Ceramic mug")
  const close = await c.closeOffer(id)
  await c.offerCommand(close!.commandId)
  const patched = await c.updateOffer(id, { product: { name: "Kubek emaliowany niebieski" }, shippingTime: { daysToShip: 5 } })
  assert.equal((await c.getOffer(id))?.name, "Ceramic mug", "nothing changes before the command is read")
  assert.equal((await c.offerCommand(patched.command!.commandId))?.status, "SUCCESS")
  const after = await c.getOffer(id)
  assert.equal(after?.name, "Kubek emaliowany niebieski")
  assert.equal(after?.status, "CLOSED", "a patch never reopens")
  assert.deepEqual(await c.updateOffer("demo-unknown", { product: { name: "Kubek emaliowany" } }), { command: null, offer: null })
  const price = await c.updateOffer(id, { price: { grossPrice: { amount: 90, currency: "PLN" }, taxRateInfo: "23%" } })
  assert.equal((await c.offerCommand(price.command!.commandId))?.status, "SUCCESS", "price and stock are fine on any offer")
})

test("import: one offer of another tool, added once, with a SKU and an EAN of no product", async () => {
  const c = createDemoClient()
  const a = c.addForeignOffer()
  const b = c.addForeignOffer()
  assert.equal(a.id, b.id)
  assert.equal(a.status, "PUBLISHED")
  assert.equal(a.sku, "ERP-TERMOS-500")
  assert.equal((await c.listOffers({ offset: 0, limit: 30 })).total, 1)
  assert.equal((await c.offerEvents({ limit: 10 })).length, 0, "no event: the sync does not link it by itself")
})
