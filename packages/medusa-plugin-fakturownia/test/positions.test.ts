import { test } from "node:test"
import assert from "node:assert/strict"
import { PayloadError } from "../src/modules/fakturownia/lib/errors.ts"
import { buildPositions, lineName, taxValue } from "../src/modules/fakturownia/lib/positions.ts"
import { order } from "./helpers.ts"

const OPTS = { defaultVatRate: 23 as const, shippingPositionName: "Dostawa", quantityUnit: "szt." }

test("line names: product and variant, just the product when the variant adds nothing", () => {
  assert.equal(lineName({ id: "1", product_title: "Krem", variant_title: "50 ml" }), "Krem, 50 ml")
  assert.equal(lineName({ id: "1", product_title: "Krem", variant_title: "Default variant" }), "Krem")
  assert.equal(lineName({ id: "1", product_title: "Krem", variant_title: "krem" }), "Krem")
  assert.equal(lineName({ id: "1", title: "Serum", subtitle: "30 ml" }), "Serum, 30 ml")
  assert.equal(lineName({ id: "1", variant_sku: "SKU-1" }), "SKU-1")
  assert.equal(lineName({ id: "1", product_title: "x".repeat(300) }).length, 256)
})

test("tax rate: from the Medusa tax lines, summed; the fallback only without tax lines", () => {
  assert.equal(taxValue([{ rate: 23 }], 8), 23)
  assert.equal(taxValue([{ rate: "8" }], 23), 8)
  assert.equal(taxValue([{ rate: { numeric: 5 } }], 23), 5)
  assert.equal(taxValue([{ rate: 5 }, { rate: 3 }], 23), 8)
  assert.equal(taxValue([], 23), 23)
  assert.equal(taxValue(null, "zw"), "zw")
  assert.equal(taxValue([{ rate: 0, code: "ZW" }], 23), "zw")
  assert.equal(taxValue([{ rate: 0, code: "np" }], 23), "np")
  assert.equal(taxValue([{ rate: 0, code: "PL0" }], 23), 0)
})

test("positions: one per line with the gross total after discounts, one per shipping method", () => {
  const r = buildPositions(order() as never, OPTS)
  assert.deepEqual(r.positions, [
    { name: "Krem nawilżający, 50 ml", code: "KREM-50", quantity: 2, quantity_unit: "szt.", total_price_gross: 123, tax: 23 },
    { name: "InPost Paczkomat", quantity: 1, quantity_unit: "szt.", total_price_gross: 20, tax: 23 },
  ])
  assert.equal(r.totalGross, 143)
  assert.equal(r.currency, "PLN")
})

test("free shipping stays on the document at 0.00, and one method takes the order's shipping total", () => {
  const r = buildPositions(order({ shipping_total: 0, shipping_methods: [{ name: "Kurier", amount: 15.49, total: 15.49, tax_lines: [{ rate: 23 }] }] }) as never, OPTS)
  assert.equal(r.positions[1].name, "Kurier")
  assert.equal(r.positions[1].total_price_gross, 0)
  const unnamed = buildPositions(order({ shipping_methods: [{ amount: 20 }] }) as never, OPTS)
  assert.equal(unnamed.positions[1].name, "Dostawa")
  assert.equal(unnamed.positions[1].tax, 23, "no tax lines: the default rate")
})

test("several shipping methods: each its own total", () => {
  const r = buildPositions(
    order({ shipping_total: 30, shipping_methods: [{ name: "A", total: 10, tax_lines: [{ rate: 23 }] }, { name: "B", total: 20, tax_lines: [{ rate: 8 }] }] }) as never,
    OPTS,
  )
  assert.deepEqual(
    r.positions.slice(1).map((p) => [p.name, p.total_price_gross, p.tax]),
    [
      ["A", 10, 23],
      ["B", 20, 8],
    ],
  )
  assert.equal(r.totalGross, 153)
})

test("no shipping methods: no shipping position (digital goods)", () => {
  const r = buildPositions(order({ shipping_methods: [] }) as never, OPTS)
  assert.equal(r.positions.length, 1)
})

test("a line without a total is rebuilt from the unit price: with tax when prices exclude it", () => {
  const exclusive = buildPositions(order({ items: [{ id: "a", product_title: "X", detail: { quantity: 2 }, unit_price: 10, discount_total: 2, tax_lines: [{ rate: 23 }] }] }) as never, OPTS)
  assert.equal(exclusive.positions[0].total_price_gross, 22.14)
  const inclusive = buildPositions(
    order({ items: [{ id: "a", product_title: "X", detail: { quantity: 2 }, unit_price: 10, discount_total: 2, is_tax_inclusive: true, tax_lines: [{ rate: 23 }] }] }) as never,
    OPTS,
  )
  assert.equal(inclusive.positions[0].total_price_gross, 18)
})

test("quantity comes from items.detail; zero lines are skipped; an unreadable quantity stops the document", () => {
  const r = buildPositions(
    order({ items: [{ id: "a", product_title: "A", detail: { quantity: 3 }, quantity: 1, total: 30 }, { id: "b", product_title: "B", detail: { quantity: 0 }, total: 0 }] }) as never,
    OPTS,
  )
  assert.equal(r.positions[0].quantity, 3)
  assert.equal(r.positions.length, 2, "line B was skipped, shipping stays")
  assert.throws(
    () => buildPositions(order({ items: [{ id: "a", product_title: "A", total: 10 }] }) as never, OPTS),
    (err: unknown) => err instanceof PayloadError && err.code === "no_quantity",
  )
  assert.throws(() => buildPositions(order({ items: [] }) as never, OPTS), (err: unknown) => err instanceof PayloadError && err.code === "no_lines")
  assert.throws(
    () => buildPositions(order({ items: [{ id: "a", product_title: "A", detail: { quantity: 1 }, total: -5 }] }) as never, OPTS),
    (err: unknown) => err instanceof PayloadError && err.code === "negative_line",
  )
})

test("amounts: BigNumber-shaped values, numeric strings, rounding to cents, the order currency", () => {
  const r = buildPositions(
    order({
      currency_code: "eur",
      shipping_total: { numeric: 4.999 },
      items: [{ id: "a", product_title: "A", detail: { quantity: { value: "1" } }, total: "19.994", tax_lines: [{ rate: 23 }] }],
    }) as never,
    OPTS,
  )
  assert.equal(r.positions[0].total_price_gross, 19.99)
  assert.equal(r.positions[1].total_price_gross, 5)
  assert.equal(r.totalGross, 24.99)
  assert.equal(r.currency, "EUR")
})
