import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseCounter,
  parseCustomerAccept,
  parseCustomerMessage,
  parseNote,
  parseOpenBody,
  parseOptionalMessage,
  parsePrice,
  parseQuantity,
} from "../src/modules/negotiations/lib/validation.ts"
import { cleanText, formatRef, isEntityId, likePattern, snippet } from "../src/modules/negotiations/lib/text.ts"

const limits = { maxMessageLength: 2000, maxQuantity: 100_000 }
const codes = (r: { ok: boolean; errors?: Array<{ field: string; code: string }> }) => (r.ok ? [] : (r.errors ?? []).map((e) => `${e.field}:${e.code}`))

test("opening: a product, a variant or a cart, with a message", () => {
  const r = parseOpenBody({ variant_id: "variant_01", quantity: "24", target_price: "469,00", currency_code: "PLN", message: "  24 pcs, please  ", extra: "ignored" }, limits)
  assert.ok(r.ok)
  if (r.ok) {
    assert.deepEqual(r.value, { productId: null, variantId: "variant_01", cartId: null, qty: 24, price: "469,00", currencyCode: "pln", message: "24 pcs, please" })
  }
  const asked = parseOpenBody({ product_id: "prod_1", message: "What is your best price for 500?" }, limits)
  assert.ok(asked.ok && asked.value.price === null && asked.value.qty === 1, "no target: the customer asks for an offer")
  const legacyQty = parseOpenBody({ product_id: "prod_1", qty: 3, message: "x" }, limits)
  assert.ok(legacyQty.ok && legacyQty.value.qty === 3, "qty, as the app module's body had it, still works")
})

test("opening: what is refused, field by field", () => {
  assert.deepEqual(codes(parseOpenBody({ message: "hi" }, limits)), ["product_id:required"])
  assert.deepEqual(codes(parseOpenBody({ cart_id: "cart_1", product_id: "prod_1", message: "hi" }, limits)), ["cart_id:invalid"])
  assert.deepEqual(codes(parseOpenBody({ cart_id: "cart_1", quantity: 5, message: "hi" }, limits)), ["quantity:invalid"], "a cart thread has no quantity")
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod 1; drop", message: "hi" }, limits)), ["product_id:invalid"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", quantity: 0, message: "hi" }, limits)), ["quantity:invalid"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", quantity: 2.5, message: "hi" }, limits)), ["quantity:invalid"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", quantity: 100_001, message: "hi" }, limits)), ["quantity:too_large"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", target_price: { amount: 5 }, message: "hi" }, limits)), ["target_price:invalid"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", currency_code: "złoty", message: "hi" }, limits)), ["currency_code:invalid"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1" }, limits)), ["message:required"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", message: "   " }, limits)), ["message:required"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", message: "x".repeat(2001) }, limits)), ["message:too_long"])
  assert.deepEqual(codes(parseOpenBody({ product_id: "prod_1", message: 42 }, limits)), ["message:invalid"])
  assert.deepEqual(codes(parseOpenBody(null, limits)), ["product_id:required", "message:required"])
})

test("messages are plain text: line breaks kept, control characters and disguises removed", () => {
  const bidi = String.fromCharCode(0x202e)
  const r = cleanText("Line one\r\n\r\n\r\n\r\nLine two" + String.fromCharCode(0) + bidi + " \t\nend", 2000)
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.text, "Line one\n\nLine two\nend")
  const emoji = cleanText("ok " + String.fromCodePoint(0x1f44d), 4)
  assert.ok(emoji.ok, "length counts characters, not UTF-16 units")
})

test("prices are checked against the thread's currency", () => {
  assert.deepEqual(parsePrice("469.00", 2, "price"), { ok: true, value: 46900 })
  assert.deepEqual(codes(parsePrice("469.005", 2, "price")), ["price:too_many_decimals"])
  assert.deepEqual(parsePrice("1200", 0, "price"), { ok: true, value: 1200 })
  assert.deepEqual(codes(parsePrice("12.5", 0, "target_price")), ["target_price:too_many_decimals"])
})

test("replies, accepts, declines, counters and notes", () => {
  const reply = parseCustomerMessage({ message: "Could we meet at 455?", target_price: "455" }, limits)
  assert.ok(reply.ok && reply.value.price === "455")
  assert.deepEqual(codes(parseCustomerMessage({ target_price: "455" }, limits)), ["message:required"])

  const accept = parseCustomerAccept({ price: "469.00" }, limits)
  assert.ok(accept.ok && accept.value.message === null && accept.value.price === "469.00")
  assert.ok(parseCustomerAccept({}, limits).ok, "an accept needs nothing")

  const decline = parseOptionalMessage({ message: "Budget cut, sorry." }, limits)
  assert.ok(decline.ok && decline.value.message === "Budget cut, sorry.")
  assert.ok(parseOptionalMessage(undefined, limits).ok)

  const counter = parseCounter({ price: "455", message: "Final offer", valid_days: "7" }, limits)
  assert.ok(counter.ok && counter.value.validDays === 7)
  assert.deepEqual(codes(parseCounter({ message: "no price" }, limits)), ["price:required"])
  assert.deepEqual(codes(parseCounter({ price: "455", valid_days: 0 }, limits)), ["valid_days:invalid"])
  assert.deepEqual(codes(parseCounter({ price: "455", valid_days: 400 }, limits)), ["valid_days:invalid"])

  assert.ok(parseNote({ note: "Floor is 440" }, limits).ok)
  assert.deepEqual(codes(parseNote({ body: "wrong field" }, limits)), ["note:required"])
})

test("quantities, ids, references, search patterns and snippets", () => {
  assert.deepEqual(parseQuantity(undefined, 10), { ok: true, qty: 1 })
  assert.deepEqual(parseQuantity(" 7 ", 10), { ok: true, qty: 7 })
  assert.deepEqual(parseQuantity(true, 10), { ok: false, code: "invalid" })
  assert.equal(isEntityId("variant_01JABC"), true)
  assert.equal(isEntityId("../etc"), false)
  assert.equal(isEntityId(""), false)
  assert.equal(formatRef(2026, 1001), "NEG-2026-1001")
  assert.equal(formatRef(2026, 7), "NEG-2026-0007")
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%")
  assert.equal(snippet("short"), "short")
  assert.ok(snippet("word ".repeat(60), 40).endsWith("…"))
  assert.ok(snippet("word ".repeat(60), 40).length <= 41)
})
