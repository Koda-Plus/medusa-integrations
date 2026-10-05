import { test } from "node:test"
import assert from "node:assert/strict"
import { computeAlerts, type AlertVariant } from "../src/modules/olx/lib/alerts.ts"
import { availabilityByVariant, hasStock, isSoldOut, stockState } from "../src/modules/olx/lib/stock.ts"

test("stock: available over the counted locations, divided by the required quantity, minimum over items", () => {
  const links = [
    {
      variant_id: "v1",
      required_quantity: 1,
      inventory: { location_levels: [{ location_id: "wh", available_quantity: 3 }, { location_id: "shop", available_quantity: 2 }] },
    },
    { variant_id: "kit", required_quantity: 2, inventory: { location_levels: [{ location_id: "wh", stocked_quantity: 9, reserved_quantity: 2 }] } },
    { variant_id: "kit", required_quantity: 1, inventory: { location_levels: [{ location_id: "wh", available_quantity: 1 }] } },
    { variant_id: "neg", required_quantity: 1, inventory: { location_levels: [{ location_id: "wh", available_quantity: -4 }] } },
  ]
  const all = availabilityByVariant(links, null)
  assert.equal(all.get("v1"), 5)
  assert.equal(all.get("kit"), 1, "min(floor(7/2), 1)")
  assert.equal(all.get("neg"), 0, "never below zero")
  const wh = availabilityByVariant(links, new Set(["wh"]))
  assert.equal(wh.get("v1"), 3)
  assert.equal(all.has("missing"), false)
})

test("stock state: untracked and backorder sell, no inventory item is unknown, zero is sold out", () => {
  assert.deepEqual(stockState({ manageInventory: false, allowBackorder: false }, 0), { kind: "untracked" })
  assert.deepEqual(stockState({ manageInventory: true, allowBackorder: true }, 0), { kind: "untracked" })
  assert.deepEqual(stockState({ manageInventory: true, allowBackorder: false }, undefined), { kind: "unknown" })
  const zero = stockState({ manageInventory: true, allowBackorder: false }, 0)
  assert.equal(isSoldOut(zero), true)
  assert.equal(hasStock(zero), false)
  assert.equal(isSoldOut({ kind: "unknown" }), false, "unknown is never sold out")
  assert.equal(hasStock({ kind: "unknown" }), false, "and never in stock")
  assert.equal(hasStock({ kind: "untracked" }), true)
})

const variant = (id: string, over: Partial<AlertVariant> = {}): AlertVariant => ({
  id,
  productId: `prod_${id}`,
  sku: id.toUpperCase(),
  productTitle: `Product ${id}`,
  productStatus: "published",
  stock: { kind: "tracked", available: 2 },
  ...over,
})

const advert = (olxId: string, status: string, variantId: string | null) => ({ olxId, title: `Advert ${olxId}`, url: `https://www.olx.pl/d/${olxId}`, status, variantId })

test("alerts: the four kinds, one per live advert or per variant", () => {
  const variants = new Map<string, AlertVariant>([
    ["sold", variant("sold", { stock: { kind: "tracked", available: 0 } })],
    ["draft", variant("draft", { productStatus: "draft" })],
    ["ended", variant("ended")],
    ["never", variant("never")],
    ["fine", variant("fine")],
    ["moderation", variant("moderation")],
    ["unknown", variant("unknown", { stock: { kind: "unknown" } })],
    ["nosku", variant("nosku", { sku: null })],
  ])
  const { alerts, counts } = computeAlerts(
    [
      advert("1", "active", "sold"),
      advert("2", "active", "sold"),
      advert("3", "active", "draft"),
      advert("4", "removed_by_user", "ended"),
      advert("5", "limited", "ended"),
      advert("6", "active", "fine"),
      advert("7", "new", "moderation"),
      advert("8", "active", "unknown"),
      advert("9", "active", null),
    ],
    variants,
  )
  assert.deepEqual(counts, { live_sold_out: 2, live_unpublished: 1, stock_not_live: 1, stock_not_listed: 1 })
  const notLive = alerts.find((a) => a.kind === "stock_not_live")
  assert.equal(notLive?.olxId, "5", "the advert over the limit represents the variant")
  assert.equal(alerts.find((a) => a.kind === "stock_not_listed")?.variantId, "never")
  assert.equal(new Set(alerts.map((a) => a.key)).size, alerts.length, "stable unique keys")
  assert.ok(!alerts.some((a) => a.variantId === "unknown"), "unknown stock raises nothing")
  assert.ok(!alerts.some((a) => a.variantId === "moderation"), "an advert in moderation is on its way")
})

test("alerts: unpublished wins over sold out, stock goes along as a number or null", () => {
  const variants = new Map<string, AlertVariant>([
    ["both", variant("both", { productStatus: "proposed", stock: { kind: "tracked", available: 0 } })],
    ["free", variant("free", { stock: { kind: "untracked" } })],
  ])
  const { alerts } = computeAlerts([advert("1", "active", "both")], variants)
  assert.equal(alerts.find((a) => a.variantId === "both")?.kind, "live_unpublished")
  assert.equal(alerts.find((a) => a.variantId === "free")?.stock, null)
  assert.equal(alerts.find((a) => a.variantId === "both")?.stock, 0)
})
