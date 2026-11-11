import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { amountOf, buildTransaction, isCartId, parseConsent, TRANSACTION_WINDOW_MS, type OrderItemLite, type OrderLite } from "../src/modules/ceneo/lib/transaction.ts"
import { reservedKeysIn } from "../src/modules/ceneo/lib/kit-guards.ts"
import { RESERVED_METADATA_PREFIXES } from "../src/modules/ceneo/lib/constants.ts"

const NOW = Date.parse("2026-11-11T12:00:00Z")

function order(over: Partial<OrderLite> = {}): OrderLite {
  return {
    id: "order_01JABCDEFGHJKMNPQRSTVWXYZ0",
    display_id: 1042,
    email: "jan@example.com",
    currency_code: "pln",
    total: 137.8,
    created_at: "2026-11-11T11:00:00Z",
    canceled_at: null,
    status: "pending",
    items: [
      { variant_id: "variant_a", variant_sku: "KUB-1", quantity: 2, total: 79.8 },
      { variant_id: "variant_b", variant_sku: "TAL-1", quantity: 1, total: 45 },
      { variant_id: null, quantity: 1, total: 0 },
      { variant_id: "variant_a", variant_sku: "KUB-1", quantity: 1, total: 13 },
    ],
    ...over,
  }
}

const byVariant = (i: OrderItemLite) => i.variant_id ?? null
const tx = (over: Partial<OrderLite> = {}, survey = true, workDays: number | null = 5) => buildTransaction({ order: order(over), offerIdOf: byVariant, survey, workDays, now: NOW })

test("transaction: the confirmation payload Ceneo documents, products as the feed offers", () => {
  const r = tx()
  assert.ok(r.ok)
  assert.deepEqual(r.transaction, {
    order_id: "1042",
    shop_products: [
      { id: "variant_a", price: 30.93, quantity: 3, currency: "PLN" },
      { id: "variant_b", price: 45, quantity: 1, currency: "PLN" },
    ],
    amount: 137.8,
    client_email: "jan@example.com",
    work_days_to_send_questionnaire: 5,
  })
})

test("transaction: no e-mail without the survey consent, no work days when Ceneo decides", () => {
  const r = tx({}, false, null)
  assert.ok(r.ok)
  assert.equal("client_email" in r.transaction, false)
  assert.equal("work_days_to_send_questionnaire" in r.transaction, false)
})

test("transaction: only within 24 hours, never for a canceled order or one without products", () => {
  assert.deepEqual(tx({ created_at: new Date(NOW - TRANSACTION_WINDOW_MS - 1000) }), { ok: false, code: "order_expired" })
  assert.deepEqual(tx({ created_at: null }), { ok: false, code: "order_expired" })
  assert.deepEqual(tx({ canceled_at: "2026-11-11T11:30:00Z" }), { ok: false, code: "order_canceled" })
  assert.deepEqual(tx({ items: [{ variant_id: null, quantity: 1, total: 10 }] }), { ok: false, code: "order_empty" })
})

test("transaction: the order number is at most 32 characters, falls back to the order id", () => {
  const r = tx({ display_id: null })
  assert.ok(r.ok)
  assert.equal(r.transaction.order_id, "order_01JABCDEFGHJKMNPQRSTVWXYZ0")
  assert.ok(r.transaction.order_id.length <= 32)
})

test("amounts: numbers, numeric strings and BigNumber-like values", () => {
  assert.equal(amountOf(12.5), 12.5)
  assert.equal(amountOf("12.50"), 12.5)
  assert.equal(amountOf({ numeric: 7 }), 7)
  assert.equal(amountOf({ toJSON: () => "3.3" }), 3.3)
  assert.equal(amountOf(Number.NaN), null)
  assert.equal(amountOf(null), null)
  const r = tx({ total: { numeric: 137.8 }, items: [{ variant_id: "v", quantity: "2", total: { toJSON: () => 20 } }] })
  assert.ok(r.ok)
  assert.deepEqual(r.transaction.shop_products, [{ id: "v", price: 10, quantity: 2, currency: "PLN" }])
})

test("consent: a cart id and a boolean, nothing else", () => {
  assert.equal(isCartId("cart_01JABCDEFGHJKMNPQRSTVWXYZ"), true)
  assert.equal(isCartId("cart_1"), false)
  assert.equal(isCartId("order_01JABCDEFGHJKMNPQRSTVWXYZ"), false)
  assert.deepEqual(parseConsent({ cart_id: "cart_01JABCDEFGHJKMNPQRSTVWXYZ", survey: true }), { ok: true, cartId: "cart_01JABCDEFGHJKMNPQRSTVWXYZ", survey: true })
  assert.equal(parseConsent({ cart_id: "cart_01JABCDEFGHJKMNPQRSTVWXYZ", survey: "yes" }).ok, false)
  assert.equal(parseConsent({ survey: true }).ok, false)
})

test("metadata guard: a shopper cannot write ceneo_ keys on carts or items", () => {
  const body = { metadata: { gift: true, Ceneo_Survey: true }, items: [{ metadata: { ceneo_offer: "x" } }] }
  assert.deepEqual(reservedKeysIn(body, RESERVED_METADATA_PREFIXES).sort(), ["Ceneo_Survey", "ceneo_offer"])
  assert.deepEqual(reservedKeysIn({ metadata: { gift: true } }, RESERVED_METADATA_PREFIXES), [])
})

/* The rule behind the guard: the plugin never reads order or cart metadata as state. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

test("metadata: only the product brand reads metadata, never an order or a cart", () => {
  const allowed = new Set(["brand.ts", "catalog.ts", "kit-guards.ts", "kit-contract.ts", "options.ts", "constants.ts", "en.ts", "pl.ts"])
  const offenders = files(join(import.meta.dirname, "..", "src")).filter((p) => /(\.metadata\b|["']metadata["']|\bmetadata\??:)/.test(readFileSync(p, "utf8")) && !allowed.has(p.split(/[\\/]/).pop() ?? ""))
  assert.deepEqual(offenders, [])
})
