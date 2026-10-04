import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { CONTRACT_VERSION } from "../src/modules/subiekt/lib/constants.ts"

const dir = new URL("../contract/", import.meta.url)
const spec = readFileSync(new URL("openapi.yaml", dir), "utf8")
const example = (name: string) => JSON.parse(readFileSync(new URL(`examples/${name}`, dir), "utf8"))

test("the plugin speaks the version the contract declares", () => {
  const m = /^info:\n(?:\s+.*\n)*?\s+version:\s*([0-9.]+)/m.exec(spec)
  assert.ok(m, "info.version not found")
  assert.equal(m[1], CONTRACT_VERSION)
})

test("every path the plugin calls is in the contract", () => {
  for (const path of ["/v1/health", "/v1/orders", "/v1/orders/{orderId}", "/v1/orders/{orderId}/cancel", "/v1/orders/{orderId}/fulfillments", "/v1/stock", "/v1/events", "/hooks/subiekt"]) {
    assert.ok(spec.includes(`\n  ${path}:\n`), path)
  }
})

test("every example file is valid JSON and referenced by the contract", () => {
  for (const file of readdirSync(new URL("examples/", dir))) {
    if (!file.endsWith(".json")) continue
    example(file)
    if (file !== "signature-vectors.json") assert.ok(spec.includes(`./examples/${file}`), `${file} is not referenced in openapi.yaml`)
  }
})

test("examples carry the required fields", () => {
  const order = example("order-create.request.json")
  for (const key of ["order_id", "display_id", "currency_code", "placed_at", "lines", "payment", "totals"]) assert.ok(key in order, key)
  for (const line of order.lines) for (const key of ["line_id", "quantity", "unit_price_gross", "total_gross"]) assert.ok(key in line, key)

  const lineSum = order.lines.reduce((s: number, l: { total_gross: number }) => s + l.total_gross, 0)
  assert.equal(Math.round(lineSum * 100), Math.round(order.totals.items_gross * 100))
  assert.equal(Math.round((order.totals.items_gross + order.totals.shipping_gross) * 100), Math.round(order.totals.total_gross * 100))

  const events = example("events.response.json")
  assert.equal(events.last_id, events.events[events.events.length - 1].id)
  for (const e of events.events) for (const key of ["id", "type", "occurred_at", "data"]) assert.ok(key in e, key)

  const stock = example("stock.response.json")
  for (const item of stock.items) for (const key of ["symbol", "quantity", "available"]) assert.ok(key in item, key)

  const health = example("health.json")
  assert.equal(health.bridge.contract, CONTRACT_VERSION)
})
