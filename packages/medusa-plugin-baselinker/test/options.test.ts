import { test } from "node:test"
import assert from "node:assert/strict"
import { planRetry, retryDelaySeconds } from "../src/modules/baselinker/lib/backoff.ts"
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from "../src/modules/baselinker/lib/constants.ts"
import {
  canExportOrders,
  canPlanStock,
  canReadCatalog,
  missingOptions,
  normalizeWarehouseId,
  resolveOptions,
} from "../src/modules/baselinker/lib/options.ts"

test("defaults: plan-only stock, orders exported, 80 requests per minute, COD prefixes", () => {
  const o = resolveOptions(undefined)
  assert.equal(o.stockSync, "plan")
  assert.equal(o.exportOrders, true)
  assert.equal(o.maxStockChangesPerRun, 500)
  assert.equal(o.requestsPerMinute, 80)
  assert.equal(o.timeoutMs, 20_000)
  assert.equal(o.skipOrderMetadataKey, "baselinker_skip")
  assert.deepEqual(o.codProviders, ["pp_cod", "pp_cash"])
  assert.equal(o.demo, false)
  assert.equal(o.catalogSyncEnabled, true)
})

test("values from environment strings: numbers, lists, booleans, warehouse keys", () => {
  const o = resolveOptions({
    apiToken: " token ",
    inventoryId: "23397",
    warehouseId: "40745",
    orderStatusId: "122665",
    fulfillOnStatusIds: "122666, 123314,x",
    exportOrders: "false",
    requestsPerMinute: "500",
    stockSync: "write",
  })
  assert.equal(o.apiToken, "token")
  assert.equal(o.inventoryId, 23397)
  assert.equal(o.warehouseId, "bl_40745")
  assert.equal(o.orderStatusId, 122665)
  assert.deepEqual(o.fulfillOnStatusIds, [122666, 123314])
  assert.equal(o.exportOrders, false)
  assert.equal(o.requestsPerMinute, 100, "never above the BaseLinker limit")
  assert.equal(o.stockSync, "write")
  assert.equal(normalizeWarehouseId("BL_12"), "bl_12")
  assert.equal(normalizeWarehouseId("magazyn"), "magazyn")
})

test("what is missing depends on what is enabled; nothing is missing in demo mode", () => {
  assert.deepEqual(missingOptions(resolveOptions({})), ["apiToken", "inventoryId", "warehouseId", "orderStatusId"])
  assert.deepEqual(missingOptions(resolveOptions({ apiToken: "t", inventoryId: 1, stockSync: "off", exportOrders: false })), [])
  assert.deepEqual(missingOptions(resolveOptions({ apiToken: "t", inventoryId: 1, warehouseId: "magazyn", orderStatusId: 2 })), ["warehouseId (like bl_12345)"])
  assert.deepEqual(missingOptions(resolveOptions({ demo: true })), [])

  const cardsOnly = resolveOptions({ apiToken: "t", inventoryId: 1 })
  assert.equal(canReadCatalog(cardsOnly), true)
  assert.equal(canPlanStock(cardsOnly), false)
  assert.equal(canExportOrders(cardsOnly), false)
  assert.equal(canExportOrders(resolveOptions({ demo: true })), true)
  assert.equal(canExportOrders(resolveOptions({ demo: true, exportOrders: false })), false)
})

test("backoff: the table, at most 10 % jitter, and a weekend of retries before a person is asked", () => {
  const none = () => 0
  assert.equal(retryDelaySeconds(1, BACKOFF_SECONDS, none), 60)
  assert.equal(retryDelaySeconds(50, BACKOFF_SECONDS, none), 43_200)
  assert.equal(retryDelaySeconds(1, BACKOFF_SECONDS, () => 0.999), 66)
  let total = 0
  for (let a = 1; a < MAX_ATTEMPTS; a += 1) total += retryDelaySeconds(a, BACKOFF_SECONDS, none)
  assert.ok(total > 2 * 24 * 3600)

  const now = new Date("2026-10-05T10:00:00Z")
  const next = planRetry({ attempts: 1, retryable: true, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now, random: none })
  assert.deepEqual(next, { status: "pending", nextAttemptAt: new Date("2026-10-05T10:01:00Z") })
  assert.deepEqual(planRetry({ attempts: 1, retryable: false, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now }), { status: "failed", nextAttemptAt: null })
  assert.deepEqual(planRetry({ attempts: MAX_ATTEMPTS, retryable: true, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now }), {
    status: "failed",
    nextAttemptAt: null,
  })
})
