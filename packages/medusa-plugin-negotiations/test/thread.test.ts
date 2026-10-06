import { test } from "node:test"
import assert from "node:assert/strict"
import { activityCutoff, effectiveExpiry, expiresSoon, isOverdue, validityFrom } from "../src/modules/negotiations/lib/expiry.ts"
import { isLegacyPriced, legacyAmounts, legacySystemNote } from "../src/modules/negotiations/lib/legacy.ts"
import { normalizeThread } from "../src/modules/negotiations/lib/thread.ts"
import type { ThreadRow } from "../src/modules/negotiations/lib/rows.ts"

const DAY = 24 * 60 * 60 * 1000
const now = new Date("2026-10-07T12:00:00Z")
const ago = (days: number) => new Date(now.getTime() - days * DAY)

test("expiry: the activity clock, an offer's own validity, closed threads never", () => {
  const open = { status: "open", expiresAt: null, lastActivityAt: ago(3) }
  assert.deepEqual(effectiveExpiry(open, 14), new Date(ago(3).getTime() + 14 * DAY))
  assert.equal(isOverdue(open, 14, now), false)
  assert.equal(isOverdue(open, 2, now), true)
  assert.equal(effectiveExpiry(open, 0), null, "expiryDays 0 turns the clock off")
  const offer = { status: "counter_offered", expiresAt: ago(-1), lastActivityAt: ago(30) }
  assert.deepEqual(effectiveExpiry(offer, 14), ago(-1), "the offer's validity decides, not the old activity")
  assert.equal(isOverdue(offer, 14, now), false)
  assert.equal(isOverdue({ ...offer, expiresAt: ago(0.01) }, 0, now), true, "a validity expires even with the clock off")
  assert.equal(effectiveExpiry({ status: "accepted", expiresAt: ago(5), lastActivityAt: ago(50) }, 14), null)
  assert.equal(expiresSoon({ status: "open", expiresAt: ago(-1), lastActivityAt: null }, 14, now), true)
  assert.equal(expiresSoon({ status: "open", expiresAt: ago(-5), lastActivityAt: null }, 14, now), false)
  assert.equal(expiresSoon({ status: "open", expiresAt: ago(1), lastActivityAt: null }, 14, now), false, "already past is not soon")
  assert.deepEqual(activityCutoff(now, 14), ago(14))
  assert.equal(activityCutoff(now, 0), null)
  assert.deepEqual(validityFrom(now, 7), ago(-7))
  assert.equal(validityFrom(now, null), null)
})

test("legacy: the app module's one price means the target, the offer or the agreed price by status", () => {
  assert.deepEqual(legacyAmounts("open", "22", 2), { requested: 2200, offered: null, agreed: null, price: 2200 })
  assert.deepEqual(legacyAmounts("counter_offered", "38.5", 2), { requested: null, offered: 3850, agreed: null, price: 3850 })
  assert.deepEqual(legacyAmounts("accepted", 72, 2), { requested: null, offered: null, agreed: 7200, price: 7200 })
  assert.deepEqual(legacyAmounts("rejected", null, 2), { requested: null, offered: null, agreed: null, price: null })
  assert.equal(isLegacyPriced({ target_price: "22" }), true)
  assert.equal(isLegacyPriced({ target_price: "22", price_amount: 2200 }), false, "once written, the new columns decide")
  assert.equal(isLegacyPriced({}), false)
})

test("legacy: the Polish system notes are read, anything else is a message", () => {
  assert.deepEqual(legacySystemNote("Kontroferta: 38.5"), { kind: "counter", amountText: "38.5" })
  assert.deepEqual(legacySystemNote("Kontroferta: 38,50"), { kind: "counter", amountText: "38.50" })
  assert.deepEqual(legacySystemNote("Negocjacja zaakceptowana."), { kind: "accepted", amountText: null })
  assert.deepEqual(legacySystemNote("Negocjacja odrzucona."), { kind: "rejected", amountText: null })
  assert.equal(legacySystemNote("Dzień dobry"), null)
})

function legacyRow(over: Partial<ThreadRow> = {}): ThreadRow {
  /* A row as the demo store's app module left it, after the migration added the defaults. */
  return {
    id: "neg_lx1abc",
    ref: "NEG-2026-0409",
    status: "counter_offered",
    customer_id: "cus_1",
    cart_id: null,
    order_id: null,
    product_id: "prod_1",
    variant_id: "variant_1",
    sku: "KS-WKT-440",
    qty: 120,
    assigned_to: "Remik",
    metadata: null,
    created_at: ago(2),
    updated_at: ago(1),
    target_price: "38.5",
    demo: false,
    source: "store",
    message_count: 3,
    last_activity_at: ago(1),
    waiting_for: "customer",
    ...over,
  }
}

test("a row of the app module reads like any thread: amounts, currency assumed, subject, turn", () => {
  const t = normalizeThread(legacyRow(), { defaultCurrency: "pln", expiryDays: 14 })
  assert.equal(t.legacy, true)
  assert.equal(t.currencyCode, "pln")
  assert.equal(t.currencyAssumed, true)
  assert.equal(t.offered, 3850)
  assert.equal(t.price, 3850)
  assert.equal(t.value, 3850 * 120)
  assert.equal(t.subject, "variant")
  assert.equal(t.waitingFor, "customer")
  assert.equal(t.assignedTo, "Remik")
  assert.equal(t.demoStory, false)
  assert.deepEqual(t.expiresAt, new Date(ago(1).getTime() + 14 * DAY))
})

test("a new row: stored amounts win, the cart value is the cart price, demo threads never run the clock", () => {
  const t = normalizeThread(
    legacyRow({
      id: "neg_new",
      status: "open",
      target_price: undefined,
      currency_code: "eur",
      requested_amount: 10000,
      price_amount: 10000,
      list_amount: 12000,
      subject: "cart",
      qty: 1,
      items: [{ variant_id: "v1", product_id: "p1", sku: "A", title: "A", quantity: 2, unit_amount: 6000 }, { bogus: true }],
      waiting_for: "team",
    }),
    { defaultCurrency: "pln", expiryDays: 14 },
  )
  assert.equal(t.legacy, false)
  assert.equal(t.currencyCode, "eur")
  assert.equal(t.currencyAssumed, false)
  assert.equal(t.value, 10000, "a cart price is for the whole cart")
  assert.equal(t.discountPercent, 16.7)
  assert.equal(t.items?.length, 1, "malformed cart lines are dropped")
  const demo = normalizeThread(legacyRow({ id: "neg_demo_01", demo: true, status: "open", last_activity_at: ago(400) }), { defaultCurrency: "pln", expiryDays: 14 })
  assert.equal(demo.expiresAt, null, "a demo thread keeps its story")
  assert.equal(demo.demoStory, true)
  const closed = normalizeThread(legacyRow({ status: "accepted", closed_at: null, updated_at: ago(3) }), { defaultCurrency: "pln", expiryDays: 14 })
  assert.equal(closed.waitingFor, null)
  assert.deepEqual(closed.closedAt, ago(3))
  assert.equal(closed.agreed, 3850)
})
