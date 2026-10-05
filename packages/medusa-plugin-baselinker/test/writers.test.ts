import { test } from "node:test"
import assert from "node:assert/strict"
import { canArm, effectiveDirections, writerState, writerStates, type ArmRecord, type WriterKey } from "../src/modules/baselinker/lib/writers.ts"
import { canImportOrders, canPushPrices, canPushStock, missingOptions, parseInvoiceField, parseOrderSources, resolveOptions } from "../src/modules/baselinker/lib/options.ts"
import { isCallAllowed } from "../src/modules/baselinker/lib/security.ts"
import { httpsUrl, resolveReferences, sinceMonth } from "../src/modules/baselinker/lib/references.ts"

const arms = (entries: Array<[WriterKey, boolean]>) =>
  new Map<WriterKey, ArmRecord>(entries.map(([k, armed]) => [k, { armed, changedBy: "user_1", changedByLabel: "anna@example.com", changedAt: "2026-10-06T08:00:00.000Z" }]))

const live = resolveOptions({ apiToken: "t", inventoryId: 1, warehouseId: "bl_1", orderStatusId: 2, priceGroupId: 5, stockSync: "write" })

test("defaults: every new writer is off, directions as in 0.1, nothing imported", () => {
  const o = resolveOptions({})
  assert.equal(o.catalogSource, "medusa")
  assert.equal(o.stockSource, "baselinker")
  assert.deepEqual(o.orderImportSources, [])
  assert.equal(o.maxCatalogChangesPerRun, 200)
  assert.equal(o.quarantineAfter, 3)
  assert.equal(o.invoiceNumberField, "extra_field_1")
  assert.deepEqual(o.invoiceNumberKinds, ["vat", "receipt"])
  assert.equal(o.exportMarketplaceOrders, false)
  const states = writerStates(live, effectiveDirections(live), new Map())
  for (const s of states) {
    if (s.key === "stockToMedusa") continue
    assert.equal(s.live, false, s.key)
  }
})

test("a writer writes only when active, allowed, configured and armed", () => {
  const d = effectiveDirections(live)
  const states = writerStates(live, d, arms([["cards", true], ["catalogImport", true], ["prices", true]]))
  assert.equal(writerState(states, "cards").live, true)
  assert.equal(writerState(states, "catalogImport").blocked, "inactive_direction", "the catalog lives in Medusa")
  assert.equal(writerState(states, "prices").live, true)
  assert.equal(writerState(states, "orderImport").blocked, "inactive_direction", "no order sources")
  assert.equal(writerState(states, "invoiceNumbers").blocked, "not_armed")
  const flipped = writerStates(resolveOptions({ ...live, catalogSource: "baselinker" } as never), { catalog: "baselinker", stock: "baselinker" }, arms([["cards", true], ["catalogImport", true]]))
  assert.equal(writerState(flipped, "cards").blocked, "inactive_direction")
  assert.equal(writerState(flipped, "prices").blocked, "inactive_direction", "prices follow the catalog")
})

test("0.1 compatibility: stockSync write arms the BaseLinker to Medusa stock writer until a person touches it", () => {
  const d = effectiveDirections(live)
  const untouched = writerState(writerStates(live, d, new Map()), "stockToMedusa")
  assert.equal(untouched.armed, true)
  assert.equal(untouched.armedBy, "options")
  assert.equal(untouched.live, true)
  const disarmed = writerState(writerStates(live, d, arms([["stockToMedusa", false]])), "stockToMedusa")
  assert.equal(disarmed.live, false)
  const planOnly = resolveOptions({ apiToken: "t", inventoryId: 1, warehouseId: "bl_1", stockSync: "plan" })
  assert.equal(writerState(writerStates(planOnly, effectiveDirections(planOnly), arms([["stockToMedusa", true]])), "stockToMedusa").hardSwitch, "stock_not_write")
})

test("hard switches: false wins, also as an environment string; disarming is always possible", () => {
  const o = resolveOptions({ ...live, writers: { cards: "false", prices: false, stockToBaseLinker: true } } as never)
  assert.deepEqual(o.writersOff, ["cards", "prices"])
  const s = writerState(writerStates(o, effectiveDirections(o), arms([["cards", true]])), "cards")
  assert.equal(s.live, false)
  assert.deepEqual(canArm(s), { ok: false, reason: "hard_off" })
})

test("demo: a visitor may pick the directions; live ignores the pick; stockSync does not gate the simulation", () => {
  const demo = resolveOptions({ demo: true })
  assert.deepEqual(effectiveDirections(demo, { catalog: "baselinker", stock: "medusa" }), { catalog: "baselinker", stock: "medusa" })
  assert.deepEqual(effectiveDirections(live, { catalog: "baselinker" }), { catalog: "medusa", stock: "baselinker" })
  const states = writerStates(demo, { catalog: "medusa", stock: "medusa" }, arms([["stockToBaseLinker", true]]))
  assert.equal(writerState(states, "stockToBaseLinker").live, true)
})

test("barrier: each permitted write needs the permit of its writer; get* and addOrder as before", () => {
  const writes: Array<[string, string]> = [
    ["addInventoryProduct", "cards"],
    ["updateInventoryProductsStock", "stockToBaseLinker"],
    ["updateInventoryProductsPrices", "prices"],
    ["setOrderFields", "invoiceNumbers"],
  ]
  for (const [method, permit] of writes) {
    assert.equal(isCallAllowed({ method, exportOrders: true }).ok, false, `${method} without a permit`)
    assert.equal(isCallAllowed({ method, exportOrders: true, permits: new Set(["other"]) }).ok, false, `${method} with another permit`)
    assert.equal(isCallAllowed({ method, exportOrders: false, permits: new Set([permit]) }).ok, true, `${method} with ${permit}`)
  }
  for (const method of ["deleteInventoryProduct", "setOrderStatus", "setOrderPayment", "addInvoice", "addInventoryCategory"]) {
    assert.equal(isCallAllowed({ method, exportOrders: true, permits: new Set(["cards", "prices", "stockToBaseLinker", "invoiceNumbers"]) }).ok, false, method)
  }
})

test("options: order sources, invoice fields, capabilities and what is missing", () => {
  assert.deepEqual(parseOrderSources("Allegro, amazon:7245, x y, allegro, erli:0012"), [
    { type: "allegro", id: null },
    { type: "amazon", id: 7245 },
    { type: "erli", id: 12 },
  ])
  assert.equal(parseInvoiceField("EXTRA_FIELD_2"), "extra_field_2")
  assert.equal(parseInvoiceField(135), "custom:135")
  assert.equal(parseInvoiceField("custom:7"), "custom:7")
  assert.equal(parseInvoiceField("notes"), "extra_field_1")
  assert.equal(canPushStock(resolveOptions({ apiToken: "t", inventoryId: 1, warehouseId: "shop_3", stockSource: "medusa" })), false)
  assert.equal(canPushPrices(resolveOptions({ apiToken: "t", inventoryId: 1 })), false)
  assert.equal(canImportOrders(resolveOptions({ apiToken: "t", orderImportSources: ["allegro"] })), true)
  assert.deepEqual(missingOptions(resolveOptions({ apiToken: "t", inventoryId: 1, warehouseId: "shop_3", stockSource: "medusa", exportOrders: false })), [
    "warehouseId (a bl_ warehouse to receive Medusa stock)",
  ])
})

test("references: lenient, never throw, https only, localized texts, YYYY-MM months", () => {
  const refs = resolveReferences([
    { name: "Sklep z oponami", url: "https://example.com", since: "2026-04", description: { pl: "Opony i felgi" }, metrics: [{ label: "cards", value: "11 000" }, { label: "", value: "x" }], links: [{ label: { en: "Product" }, url: "http://insecure.example.com" }, { label: "Product", url: "https://example.com/p/1" }] },
    { name: "", url: "https://no-name.example.com" },
    { name: "Plain http", url: "http://example.com" },
    { name: "Duplicate", url: "https://example.com" },
    "junk",
    null,
  ])
  assert.equal(refs.length, 1)
  assert.deepEqual(refs[0].description, { pl: "Opony i felgi" })
  assert.deepEqual(refs[0].metrics, [{ label: { en: "cards", pl: "cards" }, value: "11 000" }])
  assert.deepEqual(refs[0].links, [{ label: { en: "Product", pl: "Product" }, url: "https://example.com/p/1" }])
  assert.equal(refs[0].since, "2026-04")
  assert.equal(sinceMonth("2026-13"), null)
  assert.equal(httpsUrl("https://localhost"), null)
  assert.deepEqual(resolveReferences("not a list"), [])
  assert.deepEqual(resolveOptions({ references: [{ name: "A", url: "https://a.example.com" }] }).references.length, 1)
})
