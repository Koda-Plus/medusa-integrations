import { test } from "node:test"
import assert from "node:assert/strict"
import { customerAbilities, EMPTY_ENRICHMENT, personName, toMessageDto, toStoreMessageDto, toStoreThreadDto, toThreadDto } from "../src/modules/negotiations/lib/dto.ts"
import { normalizeThread } from "../src/modules/negotiations/lib/thread.ts"
import type { MessageRow, ThreadRow } from "../src/modules/negotiations/lib/rows.ts"

const now = new Date("2026-10-07T12:00:00Z")

function row(over: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: "neg_01",
    ref: "NEG-2026-1001",
    status: "counter_offered",
    customer_id: "cus_1",
    cart_id: null,
    order_id: null,
    product_id: "prod_1",
    variant_id: "variant_1",
    sku: "KS-1",
    qty: 10,
    assigned_to: "user_1",
    metadata: null,
    created_at: "2026-10-06T10:00:00.000Z",
    updated_at: "2026-10-07T10:00:00.000Z",
    demo: false,
    source: "store",
    subject: "variant",
    currency_code: "pln",
    requested_amount: 2000,
    offered_amount: 2200,
    price_amount: 2200,
    last_activity_at: "2026-10-07T10:00:00.000Z",
    waiting_for: "customer",
    message_count: 2,
    ...over,
  }
}

const msg = (over: Partial<MessageRow>): MessageRow => ({
  id: "m",
  negotiation_id: "neg_01",
  author_type: "customer",
  author_id: "cus_1",
  body: "",
  kind: "message",
  amount: null,
  internal: false,
  metadata: null,
  created_at: "2026-10-07T10:00:00.000Z",
  ...over,
})

test("the customer never sees notes, writer records, team names or ids", () => {
  const t = normalizeThread(row(), { defaultCurrency: null, expiryDays: 14 })
  const messages = [
    msg({ id: "m1", body: "20 per unit?", amount: 2000 }),
    msg({ id: "m2", author_type: "admin", author_id: "user_1", kind: "counter", body: "22 is our best", amount: 2200 }),
    msg({ id: "m3", author_type: "admin", author_id: "user_1", kind: "note", body: "Floor is 21", internal: true }),
    msg({ id: "m4", author_type: "system", author_id: null, kind: "draft_order", body: "Draft #12", internal: true }),
  ]
  const dto = toStoreThreadDto(t, { customerAccept: true, taxInclusive: false, now }, messages)
  assert.deepEqual(
    dto.messages?.map((m) => [m.id, m.author, m.kind, m.price]),
    [
      ["m1", "customer", "message", "20.00"],
      ["m2", "team", "counter", "22.00"],
    ],
  )
  const text = JSON.stringify(dto)
  for (const secret of ["user_1", "Floor is 21", "Draft #12", "assigned"]) assert.ok(!text.includes(secret), `no ${secret} in the store answer`)
  assert.equal(dto.offered_price, "22.00")
  assert.equal(dto.can_accept, true)
  assert.equal(dto.can_reply, true)
  assert.equal(dto.tax_inclusive, false)
})

test("what the customer may do: accept only an offer, nothing past the expiry, nothing when closed", () => {
  const options = { customerAccept: true, taxInclusive: false, now }
  const open = normalizeThread(row({ status: "open", waiting_for: "team", offered_amount: null }), { defaultCurrency: null, expiryDays: 14 })
  assert.deepEqual(customerAbilities(open, options), { reply: true, accept: false, decline: true })
  const stale = normalizeThread(row({ last_activity_at: "2026-09-01T00:00:00.000Z" }), { defaultCurrency: null, expiryDays: 14 })
  assert.deepEqual(customerAbilities(stale, options), { reply: false, accept: false, decline: false })
  const closed = normalizeThread(row({ status: "rejected" }), { defaultCurrency: null, expiryDays: 14 })
  assert.deepEqual(customerAbilities(closed, options), { reply: false, accept: false, decline: false })
  const offered = normalizeThread(row(), { defaultCurrency: null, expiryDays: 14 })
  assert.equal(customerAbilities(offered, { ...options, customerAccept: false }).accept, false, "the option can leave accepting to the team")
  const full = normalizeThread(row({ message_count: 200 }), { defaultCurrency: null, expiryDays: 14 })
  assert.equal(customerAbilities(full, options).reply, false)
})

test("old Polish system notes reach both sides in their own words", () => {
  const t = normalizeThread(row({ target_price: "38.5", offered_amount: null, requested_amount: null, price_amount: null, currency_code: null }), { defaultCurrency: "pln", expiryDays: 14 })
  const note = msg({ id: "old", author_type: "system", author_id: "Remik", body: "Kontroferta: 38.5" })
  const admin = toMessageDto(note, t, EMPTY_ENRICHMENT)
  assert.deepEqual(admin.legacy, { kind: "counter", price: { amount: 3850, value: "38.50" } })
  const store = toStoreMessageDto(note, t)
  assert.deepEqual(store && [store.author, store.kind, store.body, store.price], ["system", "counter", "", "38.50"])
})

test("the admin sees names: users by id, old free-text names as they were, the company first", () => {
  const users = new Map([["user_1", "Anna Nowak"]])
  assert.equal(personName("user_1", users), "Anna Nowak")
  assert.equal(personName("user_unknown", users), null)
  assert.equal(personName("Remik", users), "Remik")
  assert.equal(personName("admin", users), null)
  const t = normalizeThread(row(), { defaultCurrency: null, expiryDays: 14 })
  const e = { ...EMPTY_ENRICHMENT, users, customers: new Map([["cus_1", { id: "cus_1", email: "a@example.com", name: "Anna", company: "Elektro" }]]) }
  const dto = toThreadDto(t, e, { lastMessage: msg({ body: "a long message ".repeat(20) }), messages: [msg({ id: "m1" })] })
  assert.equal(dto.assignedName, "Anna Nowak")
  assert.equal(dto.customer?.company, "Elektro")
  assert.equal(dto.messages?.[0].authorName, "Elektro")
  assert.ok((dto.lastMessage?.snippet.length ?? 0) <= 141)
  assert.equal(dto.validUntil, null)
  assert.equal(dto.value?.value, "220.00")
})
