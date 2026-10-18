/**
 * The channel price (gross, minor units): VAT for net Medusa prices, the
 * markup, the per-offer override, the parsing of what people type; and the
 * quantity offered from Medusa inventory.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { channelPriceMinor, fromMinor, parseMarkup, parseOverride, toMinor } from "../src/modules/vonhalsky/lib/pricing.ts"
import { availableQuantity } from "../src/modules/vonhalsky/lib/stock.ts"

const base = { baseMinor: 10000, includesTax: true, vatRate: 23, markupPercent: 0, overrideMinor: null }

test("pricing: gross prices with the markup, rounded to the grosz", () => {
  assert.equal(channelPriceMinor(base), 10000)
  assert.equal(channelPriceMinor({ ...base, markupPercent: 15 }), 11500)
  assert.equal(channelPriceMinor({ ...base, markupPercent: -10 }), 9000)
  assert.equal(channelPriceMinor({ ...base, baseMinor: 4999, markupPercent: 12.5 }), 5624)
})

test("pricing: VAT is added to net Medusa prices before the markup", () => {
  assert.equal(channelPriceMinor({ ...base, includesTax: false }), 12300)
  assert.equal(channelPriceMinor({ ...base, includesTax: false, markupPercent: 10 }), 13530)
  assert.equal(channelPriceMinor({ ...base, includesTax: false, vatRate: 8 }), 10800)
})

test("pricing: the override wins, no price means no channel price", () => {
  assert.equal(channelPriceMinor({ ...base, markupPercent: 50, overrideMinor: 7999 }), 7999)
  assert.equal(channelPriceMinor({ ...base, baseMinor: null }), null)
  assert.equal(channelPriceMinor({ ...base, baseMinor: 0 }), null)
  assert.equal(channelPriceMinor({ ...base, baseMinor: null, overrideMinor: 500 }), 500)
})

test("pricing: what people type", () => {
  assert.equal(toMinor(49.99), 4999)
  assert.equal(toMinor("19.9"), 1990)
  assert.equal(toMinor("x"), null)
  assert.equal(fromMinor(4999), "49.99")
  assert.equal(fromMinor(null), null)
  assert.equal(parseMarkup("12,5"), 12.5)
  assert.equal(parseMarkup(301), null)
  assert.equal(parseMarkup(""), null)
  assert.equal(parseOverride("129,99"), 12999)
  assert.equal(parseOverride("1 299,00"), 129900)
  assert.equal(parseOverride(null), null)
  assert.equal(parseOverride(""), null)
  assert.equal(parseOverride("-5"), undefined)
  assert.equal(parseOverride("abc"), undefined)
})

test("stock: stocked minus reserved over the counted locations, the scarcest kit part wins", () => {
  const v = {
    manageInventory: true,
    items: [
      { requiredQuantity: 1, levels: [{ locationId: "sloc_1", stocked: 10, reserved: 2 }, { locationId: "sloc_2", stocked: 5, reserved: 0 }] },
      { requiredQuantity: 2, levels: [{ locationId: "sloc_1", stocked: 9, reserved: 0 }] },
    ],
  }
  assert.equal(availableQuantity(v, null, 0), 4)
  assert.equal(availableQuantity({ ...v, items: [v.items[0]] }, null, 0), 13)
  assert.equal(availableQuantity({ ...v, items: [v.items[0]] }, ["sloc_2"], 0), 5)
  assert.equal(availableQuantity({ manageInventory: true, items: [{ requiredQuantity: 1, levels: [{ locationId: "a", stocked: 1, reserved: 3 }] }] }, null, 0), 0)
  assert.equal(availableQuantity({ manageInventory: true, items: [] }, null, 0), 0)
  assert.equal(availableQuantity({ manageInventory: false, items: [] }, null, 7), 7)
})
