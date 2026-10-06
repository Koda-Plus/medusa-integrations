/**
 * The moves end to end: the real flows (open, reply, counter, accept,
 * reject, notes, expiry, the demo story) against the in-memory stores of
 * `helpers.ts`, a fake Query and a recording event bus. No network, no
 * database.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { adminAccept, adminCounter, adminMessage, adminNote, adminReject, customerAccept, customerDecline, customerMessage, openNegotiation } from "../src/workflows/negotiations/threads.ts"
import { expireNegotiations } from "../src/workflows/negotiations/expire.ts"
import { ensureDemoStory } from "../src/workflows/negotiations/demo.ts"
import { adminList, buildStatus, getNegotiationThread, storeDetail, storeList } from "../src/workflows/negotiations/read.ts"
import { ActionError } from "../src/workflows/negotiations/runtime.ts"
import { age, setup, type Setup } from "./helpers.ts"

const DAY = 24 * 60 * 60 * 1000

async function refused(p: Promise<unknown>): Promise<ActionError> {
  try {
    await p
  } catch (err) {
    if (err instanceof ActionError) return err
    throw err
  }
  assert.fail("expected a refusal")
}

async function open(s: Setup, body: Record<string, unknown> = {}, customerId = "cus_anna") {
  return openNegotiation(s.container, {
    customerId,
    body: { variant_id: "variant_drill", quantity: 24, target_price: "469.00", message: "24 drills for a new branch", ...body },
    salesChannelIds: ["sc_main"],
  })
}

test("open: a thread about a variant with its list price, a readable reference and negotiation.opened", async () => {
  const s = setup()
  const r = await open(s)
  assert.equal(r.thread.status, "open")
  assert.equal(r.thread.ref, `NEG-${new Date().getUTCFullYear()}-1001`)
  assert.equal(r.thread.requested, 46900)
  assert.equal(r.thread.price, 46900)
  assert.equal(r.thread.list, 48900, "the quantity tier from 20 pieces, not the price list")
  assert.equal(r.thread.currencyCode, "pln", "the store's default currency")
  assert.equal(r.thread.waitingFor, "team")
  assert.equal(r.thread.title, "Cordless drill 18V", "a default variant adds nothing to the title")
  assert.equal(s.events.length, 1)
  const e = s.events[0]
  assert.equal(e.name, "negotiation.opened")
  assert.equal(e.data.previous_status, null)
  assert.equal(e.data.price, "469.00")
  assert.equal(e.data.actor, "customer")
  assert.equal(e.data.message_id, r.message?.id)
  assert.equal(e.data.demo, false)
})

test("open: a product with one variant becomes a variant thread; several variants stay a product thread", async () => {
  const s = setup()
  const one = await open(s, { variant_id: undefined, product_id: "prod_screws", quantity: 100, target_price: "39" })
  assert.equal(one.thread.subject, "variant")
  assert.equal(one.thread.variantId, "variant_screws")
  assert.equal(one.thread.list, 4290)
  const many = await open(s, { variant_id: undefined, product_id: "prod_multi", quantity: 50, target_price: "40" })
  assert.equal(many.thread.subject, "product")
  assert.equal(many.thread.variantId, null)
  assert.equal(many.thread.list, null, "no single list price for several variants")
})

test("open: a cart thread prices the whole cart in the cart's currency", async () => {
  const s = setup()
  const r = await open(s, { variant_id: undefined, quantity: undefined, cart_id: "cart_anna", target_price: "1400" })
  assert.equal(r.thread.subject, "cart")
  assert.equal(r.thread.qty, 1)
  assert.equal(r.thread.list, 2 * 54900 + 10 * 4290)
  assert.equal(r.thread.value, 140000, "the cart price is the value")
  assert.equal(r.thread.items?.length, 2)
  const other = await refused(open(s, { variant_id: undefined, quantity: undefined, cart_id: "cart_ben", target_price: "100" }))
  assert.deepEqual([other.status, other.code], [404, "cart_not_found"], "someone else's cart is not found")
  const currency = await refused(open(s, { variant_id: undefined, quantity: undefined, cart_id: "cart_anna", currency_code: "eur", target_price: "100" }))
  assert.equal(currency.code, "invalid_data")
})

test("open: what the store does not sell to this customer is not found", async () => {
  const s = setup()
  assert.equal((await refused(open(s, { variant_id: "variant_saw" }))).code, "variant_not_found", "a draft product")
  assert.equal((await refused(open(s, { variant_id: "variant_nope" }))).code, "variant_not_found")
  assert.equal(
    (
      await refused(
        openNegotiation(s.container, { customerId: "cus_anna", body: { variant_id: "variant_drill", message: "hi" }, salesChannelIds: ["sc_wholesale"] }),
      )
    ).code,
    "variant_not_found",
    "not in the sales channel of the publishable key",
  )
  assert.equal((await refused(open(s, { product_id: "prod_screws" }))).code, "variant_mismatch")
  assert.equal((await refused(open(s, { currency_code: "usd" }))).code, "invalid_data", "a currency the store does not sell in")
  assert.equal((await refused(open(s, { target_price: "469.005" }))).code, "invalid_data")
  assert.equal(s.events.length, 0)
})

test("open: one open thread per subject and customer, and a cap of active threads", async () => {
  const s = setup({ maxActivePerCustomer: 2 })
  const first = await open(s)
  const again = await refused(open(s))
  assert.deepEqual([again.status, again.code, again.extra.negotiation_id], [409, "already_open", first.thread.id])
  await open(s, { variant_id: "variant_gloves", quantity: 10, target_price: "7" })
  const third = await refused(open(s, { variant_id: "variant_screws", quantity: 10, target_price: "40" }))
  assert.equal(third.code, "too_many_active")
  const other = await open(s, {}, "cus_ben")
  assert.ok(other.thread.id !== first.thread.id, "another customer has their own")
})

test("ownership: someone else's thread, the other mode and the demo story are 404 for the customer", async () => {
  const s = setup()
  const r = await open(s)
  const stranger = await refused(customerMessage(s.container, { customerId: "cus_ben", id: r.thread.id, body: { message: "mine?" } }))
  assert.deepEqual([stranger.status, stranger.code], [404, "not_found"])
  await assert.rejects(storeDetail(s.container, "cus_ben", r.thread.id), (e: unknown) => e instanceof ActionError && e.status === 404)
  /* The same thread is invisible to the same customer when the store runs in the other mode. */
  ;(s.options as { demo: boolean }).demo = true
  await assert.rejects(storeDetail(s.container, "cus_anna", r.thread.id), (e: unknown) => e instanceof ActionError && e.status === 404)
  ;(s.options as { demo: boolean }).demo = false
  const mine = await storeDetail(s.container, "cus_anna", r.thread.id)
  assert.equal(mine.negotiation.id, r.thread.id)
  assert.equal(mine.negotiation.messages?.length, 1)
})

test("the conversation: counter, a new target, a second counter, the customer accepts the offer they saw", async () => {
  const s = setup()
  const { thread } = await open(s)
  const counter = await adminCounter(s.container, { id: thread.id, actorId: "user_1", body: { price: "499", message: "With delivery", valid_days: 7 } })
  assert.equal(counter.thread.status, "counter_offered")
  assert.equal(counter.thread.offered, 49900)
  assert.equal(counter.thread.waitingFor, "customer")
  assert.equal(counter.thread.assignedTo, "user_1")
  assert.ok(counter.thread.validUntil && counter.thread.validUntil.getTime() > Date.now() + 6 * DAY)

  const proposal = await customerMessage(s.container, { customerId: "cus_anna", id: thread.id, body: { message: "Meet at 485?", target_price: "485" } })
  assert.equal(proposal.thread.status, "open", "a new target puts the ball back in the team's court")
  assert.equal(proposal.thread.requested, 48500)
  assert.equal(proposal.thread.validUntil, null, "a new target clears the old offer's validity")

  await adminCounter(s.container, { id: thread.id, actorId: "user_1", body: { price: "492" } })
  const stale = await refused(customerAccept(s.container, { customerId: "cus_anna", id: thread.id, body: { price: "499.00" } }))
  assert.deepEqual([stale.code, stale.extra.offered_price], ["offer_changed", "492.00"], "never agree to a price the customer did not read")

  const accepted = await customerAccept(s.container, { customerId: "cus_anna", id: thread.id, body: { price: "492.00", message: "Deal" } })
  assert.equal(accepted.thread.status, "accepted")
  assert.equal(accepted.thread.agreed, 49200)
  assert.equal(accepted.thread.closedBy, "customer")
  assert.deepEqual(
    s.events.map((e) => `${e.name}:${e.data.previous_status ?? "-"}>${e.data.status}:${e.data.actor}`),
    [
      "negotiation.opened:->open:customer",
      "negotiation.countered:open>counter_offered:admin",
      "negotiation.message_added:counter_offered>open:customer",
      "negotiation.countered:open>counter_offered:admin",
      "negotiation.accepted:counter_offered>accepted:customer",
    ],
  )
  assert.equal(s.events.at(-1)?.data.agreed_price, "492.00")
  const closed = await refused(customerMessage(s.container, { customerId: "cus_anna", id: thread.id, body: { message: "one more thing" } }))
  assert.deepEqual([closed.status, closed.code], [409, "closed"])
})

test("accept or reject, never both: two people on the same countered thread", async () => {
  const s = setup()
  const { thread } = await open(s)
  await adminCounter(s.container, { id: thread.id, actorId: "user_1", body: { price: "499" } })
  const results = await Promise.allSettled([
    customerAccept(s.container, { customerId: "cus_anna", id: thread.id, body: {} }),
    adminReject(s.container, { id: thread.id, actorId: "user_2", body: { message: "Sold out" } }),
    customerDecline(s.container, { customerId: "cus_anna", id: thread.id, body: {} }),
  ])
  const won = results.filter((r) => r.status === "fulfilled")
  assert.equal(won.length, 1, "exactly one move closes the thread")
  for (const r of results) if (r.status === "rejected") assert.equal((r.reason as ActionError).code, "closed")
  const closing = s.events.filter((e) => e.name === "negotiation.accepted" || e.name === "negotiation.rejected")
  assert.equal(closing.length, 1, "and exactly one event says so")
})

test("the team accepts the price on the table; without one it must counter first", async () => {
  const s = setup()
  const asked = await open(s, { target_price: undefined, message: "Best price for 24?" })
  const none = await refused(adminAccept(s.container, { id: asked.thread.id, actorId: "user_1", body: {} }))
  assert.equal(none.code, "no_price")
  const priced = await open(s, { variant_id: "variant_gloves", quantity: 100, target_price: "7.50" })
  const changed = await refused(adminAccept(s.container, { id: priced.thread.id, actorId: "user_1", body: { price: "7.00" } }))
  assert.equal(changed.code, "price_changed")
  const ok = await adminAccept(s.container, { id: priced.thread.id, actorId: "user_1", body: { price: "7.50" } })
  assert.deepEqual([ok.thread.status, ok.thread.agreed, ok.thread.closedBy], ["accepted", 750, "admin"])
})

test("customer accept: only an offer, and only when the store lets customers accept", async () => {
  const s = setup()
  const { thread } = await open(s)
  assert.equal((await refused(customerAccept(s.container, { customerId: "cus_anna", id: thread.id, body: {} }))).code, "no_offer")
  const locked = setup({ customerAccept: false })
  const t2 = await open(locked)
  await adminCounter(locked.container, { id: t2.thread.id, actorId: null, body: { price: "480" } })
  const off = await refused(customerAccept(locked.container, { customerId: "cus_anna", id: t2.thread.id, body: {} }))
  assert.deepEqual([off.status, off.code], [403, "accept_disabled"])
})

test("notes: internal, on closed threads too, no event, no turn change, never in the store", async () => {
  const s = setup()
  const { thread } = await open(s)
  await adminReject(s.container, { id: thread.id, actorId: "user_1", body: { message: "Below our cost" } })
  const before = s.events.length
  const noted = await adminNote(s.container, { id: thread.id, actorId: "user_1", body: { note: "Offer 470 next time" } })
  assert.equal(noted.thread.status, "rejected")
  assert.equal(s.events.length, before)
  assert.equal(noted.thread.messageCount, 2, "notes do not count as conversation")
  const store = await storeDetail(s.container, "cus_anna", thread.id)
  assert.ok(!JSON.stringify(store).includes("470 next time"))
  const admin = await getNegotiationThread(s.container, thread.id)
  assert.equal(admin?.messages?.filter((m) => m.internal).length, 1)
})

test("expiry: a stale thread closes on the customer's next move, and in the hourly pass with its event", async () => {
  const s = setup({ expiryDays: 14 })
  const a = await open(s)
  age(s, a.thread.id, 15 * DAY)
  const late = await refused(customerMessage(s.container, { customerId: "cus_anna", id: a.thread.id, body: { message: "Still there?" } }))
  assert.deepEqual([late.status, late.code], [409, "expired"])
  assert.equal(s.memory.threads.get(a.thread.id)?.status, "expired")

  const b = await open(s, { variant_id: "variant_gloves", quantity: 10, target_price: "7" })
  const c = await open(s, { variant_id: "variant_screws", quantity: 10, target_price: "40" })
  await adminCounter(s.container, { id: c.thread.id, actorId: null, body: { price: "41", valid_days: 1 } })
  age(s, b.thread.id, 20 * DAY)
  age(s, c.thread.id, 2 * DAY)
  const run = await expireNegotiations(s.container, "schedule")
  assert.equal(run?.counts.expired, 2, "the stale one by the clock, the countered one by its own validity")
  const expired = s.events.filter((e) => e.name === "negotiation.expired")
  assert.equal(expired.length, 3)
  assert.deepEqual(expired.slice(1).map((e) => e.data.previous_status).sort(), ["counter_offered", "open"])
  assert.ok(expired.every((e) => e.data.actor === "system"))
  const again = await expireNegotiations(s.container, "schedule")
  assert.equal(again?.counts.expired, 0, "nothing twice")
})

test("expiry is off with 0 days, except for offers that carry their own validity", async () => {
  const s = setup({ expiryDays: 0 })
  const a = await open(s)
  age(s, a.thread.id, 400 * DAY)
  const run = await expireNegotiations(s.container, "manual")
  assert.equal(run?.counts.expired, 0)
  assert.ok((await customerMessage(s.container, { customerId: "cus_anna", id: a.thread.id, body: { message: "hello" } })).thread.status === "open")
})

test("old rows of the app module: read as they are, written into the new columns on the first move", async () => {
  const s = setup()
  const at = new Date(Date.now() - DAY)
  s.memory.threads.set("neg_legacy1", {
    id: "neg_legacy1",
    ref: "NEG-2026-0409",
    status: "counter_offered",
    customer_id: "cus_anna",
    cart_id: null,
    order_id: null,
    product_id: "prod_screws",
    variant_id: "variant_screws",
    sku: "KS-SCREW-440",
    qty: 120,
    assigned_to: "Remik",
    metadata: null,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    target_price: "38.5",
    demo: false,
    source: "store",
    message_count: 3,
    last_activity_at: at,
    waiting_for: "customer",
  })
  s.memory.messages.push({ id: "negmsg_old", negotiation_id: "neg_legacy1", author_type: "system", author_id: "Remik", body: "Kontroferta: 38.5", kind: "message", internal: false, created_at: at })
  const list = await adminList(s.container, { status: "counter_offered" })
  assert.equal(list.threads[0].offered?.value, "38.50")
  assert.equal(list.threads[0].currencyAssumed, true)
  assert.equal(list.threads[0].assignedName, "Remik")
  const accepted = await customerAccept(s.container, { customerId: "cus_anna", id: "neg_legacy1", body: { price: "38.50" } })
  assert.equal(accepted.thread.agreed, 3850)
  const stored = s.memory.threads.get("neg_legacy1")
  assert.deepEqual([stored?.currency_code, stored?.offered_amount, stored?.agreed_amount, stored?.target_price], ["pln", 3850, 3850, "38.5"], "the old column stays untouched")
})

test("demo mode: the story is built once, apart from real threads, shown in the admin and never in the store", async () => {
  const s = setup({ demo: true })
  assert.equal(await ensureDemoStory(s.container), true)
  assert.equal(await ensureDemoStory(s.container), false, "fresh: nothing to rebuild")
  const status = await buildStatus(s.container)
  assert.equal(status.mode, "demo")
  assert.equal(status.counts.all, 9)
  assert.equal(status.counts.fromStore, 0)
  assert.ok(status.counts.waiting >= 4)
  assert.equal(status.demo?.threads, 9)
  assert.equal(status.writers.draftOrders.allowed, true, "in demo mode the writer is allowed, and only simulates")
  assert.equal(status.writers.draftOrders.armed, false)
  const story = await storeList(s.container, "cus_anna", {})
  assert.equal(story.count, 0, "the story borrows customers but never shows them a thread")
  /* A customer of the demo store opens a real request: a demo thread, visible to them. */
  const mine = await open(s)
  assert.equal(mine.thread.demo, true)
  assert.equal((await storeList(s.container, "cus_anna", {})).count, 1)
  assert.equal(s.events.at(-1)?.data.demo, true)
  const live = setup({ demo: false })
  for (const [id, row] of s.memory.threads) live.memory.threads.set(id, row)
  assert.equal((await buildStatus(live.container)).counts.all, 0, "live mode never shows demo rows")
  const pass = await expireNegotiations(s.container, "manual")
  assert.equal(pass?.status, "skipped", "demo threads keep their story")
})

test("demo story: a day later it is rebuilt in place, answers of visitors undone", async () => {
  const s = setup({ demo: true })
  await ensureDemoStory(s.container)
  const first = [...s.memory.threads.values()].find((t) => t.status === "open" && t.id.startsWith("neg_demo_"))
  assert.ok(first)
  await adminReject(s.container, { id: first!.id, actorId: "user_demo", body: {} })
  assert.equal(s.memory.threads.get(first!.id)?.status, "rejected")
  const marker = s.memory.settings.get("demo:story")!
  ;(marker.value as { seededAt: string }).seededAt = new Date(Date.now() - 2 * DAY).toISOString()
  assert.equal(await ensureDemoStory(s.container), true)
  assert.equal(s.memory.threads.get(first!.id)?.status, "open")
  assert.equal([...s.memory.threads.keys()].filter((id) => id.startsWith("neg_demo_")).length, 9, "replaced, not added")
})

test("the queue: filters, search across references and customers, waiting first in the counters", async () => {
  const s = setup()
  const a = await open(s)
  const b = await open(s, { variant_id: "variant_gloves", quantity: 10, target_price: "7" }, "cus_ben")
  await adminMessage(s.container, { id: b.thread.id, actorId: "user_1", body: { message: "Which size?" } })
  const waiting = await adminList(s.container, { status: "waiting" })
  assert.deepEqual(waiting.threads.map((t) => t.id), [a.thread.id])
  assert.deepEqual((await adminList(s.container, { q: "elektro" })).threads.map((t) => t.id), [a.thread.id], "by the company the customer module finds")
  assert.equal((await adminList(s.container, { q: a.thread.ref })).count, 1)
  assert.equal((await adminList(s.container, { customer_id: "cus_ben" })).threads[0]?.customer?.email, "ben@example.com")
  const c = await open(s, { variant_id: "variant_screws", quantity: 50, target_price: "40" })
  age(s, a.thread.id, DAY)
  assert.deepEqual((await adminList(s.container, { status: "waiting", order: "oldest", limit: 1 })).threads.map((t) => t.id), [a.thread.id], "the one waiting longest first")
  assert.deepEqual((await adminList(s.container, { status: "waiting" })).threads.map((t) => t.id), [c.thread.id, a.thread.id])
  const status = await buildStatus(s.container)
  assert.equal(status.counts.open, 3)
  assert.equal(status.counts.waiting, 2)
  assert.deepEqual(status.valueInTalks, [{ currencyCode: "pln", amount: 24 * 46900 + 10 * 700 + 50 * 4000, value: "13326.00" }])
})
