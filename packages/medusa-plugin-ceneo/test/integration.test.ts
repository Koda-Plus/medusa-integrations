/**
 * Ceneo in the koda.integration/1 contract: the shared conformance checks on
 * sample rows, then what Ceneo itself promises: an order is Ceneo's only
 * when a row of the current mode names it, the most urgent state of the
 * writes speaks, a product line follows its worst variant, and the
 * counters are the Ceneo page's.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ceneoCounters, kupTerazLine, productSummary } from "../src/modules/ceneo/lib/integration.ts"
import { makeContext } from "../src/modules/ceneo/lib/kit-routes.ts"
import { resolveOptions } from "../src/modules/ceneo/lib/options.ts"
import { ceneoIntegration } from "../src/workflows/ceneo/integration.ts"
import { conformance } from "./kit-conformance.ts"

type R = Record<string, unknown> & { id: string }

/** Equality, a list (`in`), `$ne: null`, `$lt`; anything else matches. */
function matches(row: R, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([k, f]) => {
    if (k === "$or") return (f as Record<string, unknown>[]).some((x) => matches(row, x))
    const v = row[k] ?? null
    if (Array.isArray(f)) return f.includes(v)
    if (f && typeof f === "object" && !(f instanceof Date)) {
      const op = f as Record<string, unknown>
      if ("$ne" in op) return v !== op.$ne
      return true
    }
    return v === (f ?? null)
  })
}

function fakeScope(demo: boolean) {
  const writes: string[] = []
  const tables: Record<string, R[]> = {
    orders: [
      { id: "cor_1", ceneo_order_id: "c-1", displayed_order_id: "1001", import_status: "imported", medusa_order_id: "order_A", ceneo_writes: { confirmed_at: "t", sent_at: "t" }, demo, synced_at: "2026-11-10T10:00:00Z" },
      { id: "cor_2", ceneo_order_id: "c-2", displayed_order_id: "1002", import_status: "imported", medusa_order_id: "order_B", ceneo_writes: { attention: "Fulfilled, cancelled at Ceneo" }, demo, synced_at: "2026-11-10T10:00:00Z" },
      { id: "cor_3", ceneo_order_id: "c-3", displayed_order_id: "1003", import_status: "held", medusa_order_id: "order_C", ceneo_writes: null, demo, synced_at: "2026-11-10T10:00:00Z" },
      /* A row of the other mode never speaks for the order. */
      { id: "cor_4", ceneo_order_id: "c-4", displayed_order_id: "1004", import_status: "held", medusa_order_id: "order_A", ceneo_writes: null, demo: !demo, synced_at: "2026-11-10T10:00:00Z" },
    ],
    offers: [
      { id: "cof_1", product_id: "prod_1", state: "ok", in_feed: true, retired_at: null },
      { id: "cof_2", product_id: "prod_1", state: "error", in_feed: false, retired_at: null },
      { id: "cof_3", product_id: "prod_2", state: "ok", in_feed: true, retired_at: null },
    ],
    writers: [{ id: "status", armed: true, mode: demo ? "demo" : "live", tripped_at: null }],
  }
  const list = (t: string) => async (filters: Record<string, unknown> = {}, config: { take?: number | null } = {}) => {
    const rows = tables[t].filter((r) => matches(r, filters))
    return typeof config.take === "number" ? rows.slice(0, config.take) : rows
  }
  const count = (t: string) => async (filters: Record<string, unknown> = {}) => {
    const rows = tables[t].filter((r) => matches(r, filters))
    return [rows.slice(0, 1), rows.length]
  }
  const svc: Record<string, unknown> = {
    getOptions: () => resolveOptions({ demo, feed: { token: "a".repeat(24), productUrl: "https://shop.example.com/p/{handle}" }, writes: { status: true } }),
    getLogger: () => ({ info() {}, warn() {}, error() {} }),
    isDemo: () => demo,
    listCeneoOrders: list("orders"),
    listAndCountCeneoOrders: count("orders"),
    listCeneoOffers: list("offers"),
    listAndCountCeneoOffers: count("offers"),
    listCeneoWriters: list("writers"),
  }
  const recorded = new Proxy(svc, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (/^(create|update|delete|upsert)/.test(key)) return () => writes.push(key)
      return undefined
    },
  })
  return { scope: { resolve: (k: string) => (k === "ceneo" ? recorded : undefined) }, writes: () => writes }
}

const sample = fakeScope(true)
conformance({ routes: ceneoIntegration, scope: sample.scope, entity: "order", knownIds: ["order_A", "order_B", "order_C"], writes: sample.writes })
conformance({ routes: ceneoIntegration, scope: fakeScope(true).scope, entity: "product", knownIds: ["prod_1", "prod_2"] })

test("ceneo: an order is Ceneo's only through a row of the current mode", async () => {
  const ctx = makeContext({ scope: fakeScope(true).scope, lang: "en", actorId: "user_test", actorType: "user" })
  const [a, b, c, d] = await ceneoIntegration.build.summaries(ctx, "order", ["order_A", "order_B", "order_C", "order_Z"])
  assert.equal(a.state, "ok")
  assert.equal(b.state, "attention")
  assert.equal(c.state, "attention")
  assert.equal(d.state, "none")
})

test("ceneo: the most urgent state of the writes speaks", () => {
  const base = { id: "cor", ceneo_order_id: "c", import_status: "imported" }
  assert.equal(kupTerazLine({ ...base, ceneo_writes: { sent_at: "t", attention: "x" } }).state, "attention")
  assert.equal(kupTerazLine({ ...base, ceneo_writes: { attempts: 5, error: "x" } }).state, "failed")
  assert.equal(kupTerazLine({ ...base, ceneo_writes: { canceled_by_ceneo_at: "t" } }).state, "none")
  assert.equal(kupTerazLine({ ...base, ceneo_writes: { shipment: { tracking: "PL1", carrier_id: 1, queued_at: "t" } } }).state, "active")
  assert.equal(kupTerazLine({ ...base, ceneo_writes: { sent_at: "t" } }).state, "ok")
  assert.equal(kupTerazLine({ ...base, import_status: "held" }).state, "attention")
  /* Out of attempts: afterWriteFailure writes the note too, the failure speaks. */
  assert.equal(kupTerazLine({ ...base, ceneo_writes: { attempts: 5, error: "x", attention: "refused 5 times" } }).state, "failed")
  /* A failed import with no attempt left waits for a person; one still retrying does not. */
  assert.equal(kupTerazLine({ ...base, import_status: "failed", import_attempts: 5 }).state, "attention")
  assert.equal(kupTerazLine({ ...base, import_status: "failed", import_attempts: 2 }).state, "active")
})

test("ceneo: a product follows its worst variant, the counters are the page's", () => {
  assert.equal(productSummary([])?.state, undefined)
  assert.equal(productSummary([{ state: "ok", in_feed: true }, { state: "error" }])?.state, "failed")
  assert.equal(productSummary([{ state: "excluded" }])?.state, "none")
  assert.deepEqual(productSummary([{ state: "ok", in_feed: true }, { state: "excluded" }])?.title, { key: "integration.product.inFeedSome", params: { done: 1, total: 2 } })
  const counters = ceneoCounters({ importsHeld: 2, writesAttention: 1, writesCapped: true, offerErrors: 3, writersTripped: 0 })
  assert.deepEqual(counters.map((c) => [c.key, c.scope, c.count]), [["imports_held", "orders", 2], ["writes_attention", "orders", 1], ["offer_errors", "products", 3], ["writers_tripped", "integration", 0]])
  assert.equal(counters[1].capped, true)
  assert.ok(counters.every((c) => c.link.kind === "admin" && c.link.href === "/ceneo"))
})
