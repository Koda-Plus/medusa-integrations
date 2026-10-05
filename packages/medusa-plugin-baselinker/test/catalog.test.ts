import { test } from "node:test"
import assert from "node:assert/strict"
import { parseInventories, parseProductsList, parseStatusList, readAllPages, type CatalogPage } from "../src/modules/baselinker/lib/catalog.ts"

test("a page keyed by card id: id from the key, stock of the configured warehouse only", () => {
  const page = parseProductsList(
    {
      "232696614": { ean: "5901234123457", sku: " WZ-138 XD ", name: "Felga", prices: { "20702": 450, x: "n/a" }, stock: { bl_40745: 2, shop_1: 9 } },
      "232696615": { id: 232696615, sku: "", name: "Bez SKU", stock: { shop_1: 4 } },
      "0": { name: "broken" },
      "232696616": { id: "232696616", parent_id: 232696614, sku: "WZ-138 XD/2", stock: { bl_40745: -1 } },
    },
    "bl_40745",
  )
  assert.equal(page.entries, 4)
  assert.equal(page.cards.length, 3)
  const [a, b, c] = page.cards
  assert.deepEqual(a, { blProductId: "232696614", parentId: null, sku: "WZ-138 XD", ean: "5901234123457", name: "Felga", stock: 2, prices: { "20702": 450 } })
  assert.equal(b.sku, null)
  assert.equal(b.stock, null, "no number for the warehouse is unknown, not zero")
  assert.equal(c.parentId, "232696614")
  assert.equal(c.stock, -1, "negative stock is kept as read")
})

test("an array page reads the same way", () => {
  const page = parseProductsList([{ id: 5, sku: "A", ean: 12345678, stock: { bl_1: "3" } }], "bl_1")
  assert.deepEqual(page.cards[0], { blProductId: "5", parentId: null, sku: "A", ean: "12345678", name: "", stock: 3, prices: null })
})

function pages(sizes: number[], failAt?: number) {
  let id = 0
  return async (page: number): Promise<CatalogPage> => {
    if (failAt === page) throw new Error("ERROR_NETWORK")
    const size = sizes[page - 1] ?? 0
    const cards = Array.from({ length: size }, () => {
      id += 1
      return { blProductId: String(id), parentId: null, sku: `S${id}`, ean: null, name: "", stock: 1, prices: null }
    })
    return { cards, entries: size }
  }
}

test("paging: a short page ends a complete read, so does an empty one", async () => {
  const short = await readAllPages(pages([3, 3, 1]), { pageSize: 3, maxPages: 10 })
  assert.equal(short.complete, true)
  assert.equal(short.pages, 3)
  assert.equal(short.cards.length, 7)
  const empty = await readAllPages(pages([3, 3, 0]), { pageSize: 3, maxPages: 10 })
  assert.equal(empty.complete, true)
  assert.equal(empty.cards.length, 6)
})

test("paging: a failed page or the ceiling makes the read incomplete, never an exception", async () => {
  const failed = await readAllPages(pages([3, 3, 3], 3), { pageSize: 3, maxPages: 10 })
  assert.equal(failed.complete, false)
  assert.equal(failed.pages, 2)
  assert.equal(failed.cards.length, 6)
  assert.match(failed.reason ?? "", /page 3/)

  const first = await readAllPages(pages([3], 1), { pageSize: 3, maxPages: 10 })
  assert.equal(first.complete, false)
  assert.equal(first.pages, 0)

  const ceiling = await readAllPages(pages([3, 3, 3, 3]), { pageSize: 3, maxPages: 2 })
  assert.equal(ceiling.complete, false)
  assert.match(ceiling.reason ?? "", /ceiling/)
})

test("inventories and statuses parse from either shape", () => {
  assert.deepEqual(parseInventories([{ inventory_id: 31, name: "Main", warehouses: ["BL_12", "shop_3"], default_warehouse: "bl_12" }]), [
    { id: 31, name: "Main", warehouses: ["bl_12", "shop_3"], defaultWarehouse: "bl_12" },
  ])
  const statuses = parseStatusList({ "122665": { name: "Do zebrania" }, x: { id: 5, name_for_customer: "Wysłane" } })
  assert.equal(statuses.get(122665), "Do zebrania")
  assert.equal(statuses.get(5), "Wysłane")
})
