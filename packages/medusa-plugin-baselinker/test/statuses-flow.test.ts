/**
 * The way back end to end: the real `syncStatuses` (candidates, status names,
 * single and batched reads, tracking links, order metadata, events, runs)
 * against an in-memory service, a fake container and a scripted
 * connector.php. No network.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { syncStatuses } from "../src/workflows/baselinker/statuses.ts"
import { demoPace } from "../src/modules/baselinker/lib/demo.ts"
import { fakeService } from "./fakes.ts"

type Row = Record<string, any>

function setup(options: BaseLinkerPluginOptions, rows: Row[]) {
  const f = fakeService(options)
  const o = f.svc.getOptions()
  const table = f.table("Orders")
  for (const r of rows) table.create({ demo: o.demo, status: "sent", status_checked_at: null, ...r })
  const runs = f.table("SyncRuns")
  const metadata = new Map<string, Row>()
  const events: Array<{ name: string; data: Row }> = []
  const registry: Record<string, unknown> = {
    baselinker: f.svc,
    order: {
      retrieveOrder: async (id: string) => ({ id, metadata: { ...(metadata.get(id) ?? {}) } }),
      updateOrders: async (id: string, data: Row) => void metadata.set(id, data.metadata),
    },
    event_bus: { emit: async (e: { name: string; data: Row }) => void events.push(e) },
  }
  const container = { resolve: (key: string) => registry[key] }
  return {
    container,
    get orders() {
      return table.rows
    },
    get runs() {
      return runs.rows
    },
    metadata,
    events,
  }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function fakeBaseLinker(held: Row[]) {
  const calls: Array<{ method: string; params: Row }> = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== "https://api.baselinker.com/connector.php") throw new Error(`unexpected URL ${String(url)}`)
    const body = new URLSearchParams(String(init?.body ?? ""))
    const method = body.get("method") ?? ""
    const params = JSON.parse(body.get("parameters") ?? "{}")
    calls.push({ method, params })
    const reply = (b: unknown) => new Response(JSON.stringify(b))
    if (method === "getOrderStatusList") return reply({ status: "SUCCESS", statuses: [{ id: 5, name: "Wysłane" }, { id: 4, name: "Do spakowania" }] })
    if (method === "getOrders") {
      if (params.order_id) return reply({ status: "SUCCESS", orders: held.filter((o) => o.order_id === params.order_id) })
      if (params.filter_order_source === "personal") {
        return reply({ status: "SUCCESS", orders: held.filter((o) => o.order_source_id === params.filter_order_source_id && o.order_id >= params.id_from) })
      }
    }
    return reply({ status: "ERROR", error_code: "ERROR_UNKNOWN_METHOD" })
  }) as typeof fetch
  return calls
}

const sentAt = new Date(Date.now() - 3600 * 1000)
const live: BaseLinkerPluginOptions = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, warehouseId: "bl_1", orderStatusId: 1, closedStatusIds: [9] }

test("live: status names, tracking links, metadata and the event, read order by order", async () => {
  const calls = fakeBaseLinker([
    { order_id: 501, order_status_id: 5, delivery_package_nr: "1050500491500U", delivery_package_module: "dpd" },
    { order_id: 502, order_status_id: 4, delivery_package_nr: "", delivery_package_module: "" },
  ])
  const s = setup(live, [
    { order_id: "order_1", display_id: 1, bl_order_id: "501", bl_status_id: 4, bl_status_name: "Do spakowania", sent_at: sentAt },
    { order_id: "order_2", display_id: 2, bl_order_id: "502", bl_status_id: 4, bl_status_name: "Do spakowania", sent_at: sentAt },
    { order_id: "order_3", display_id: 3, bl_order_id: "503", bl_status_id: 9, sent_at: sentAt },
  ])
  const stats = await syncStatuses(s.container, "schedule")
  assert.equal(stats?.candidates, 2, "status 9 closes an order")
  assert.equal(stats?.read, 2)
  assert.equal(stats?.changed, 1)
  assert.deepEqual(
    calls.map((c) => c.method),
    ["getOrderStatusList", "getOrders", "getOrders"],
  )
  assert.deepEqual(s.metadata.get("order_1"), {
    baselinker_status_id: 5,
    baselinker_status_name: "Wysłane",
    baselinker_tracking_number: "1050500491500U",
    baselinker_tracking_url: "https://tracktrace.dpd.com.pl/parcelDetails?p1=1050500491500U",
    baselinker_carrier: "DPD",
  })
  assert.equal(s.metadata.has("order_2"), false, "nothing changed, nothing written")
  assert.equal(s.events.length, 1)
  assert.equal(s.events[0].name, "baselinker.order_status_changed")
  assert.equal(s.events[0].data.previous_status_id, 4)
  assert.equal(s.runs.length, 1)
})

test("live: with a custom order source, one batched read covers the orders", async () => {
  const calls = fakeBaseLinker([
    { order_id: 601, order_source_id: 77, order_status_id: 5, delivery_package_nr: "AB1", delivery_package_module: "inpost" },
    { order_id: 602, order_source_id: 77, order_status_id: 4 },
  ])
  const s = setup({ ...live, customSourceId: 77 }, [
    { order_id: "order_1", bl_order_id: "601", bl_status_id: null, sent_at: sentAt },
    { order_id: "order_2", bl_order_id: "602", bl_status_id: null, sent_at: sentAt },
  ])
  const stats = await syncStatuses(s.container, "manual")
  assert.equal(stats?.read, 2)
  assert.deepEqual(
    calls.map((c) => c.method),
    ["getOrderStatusList", "getOrders"],
  )
  assert.equal(calls[1].params.filter_order_source_id, 77)
  assert.equal(s.orders[0].tracking_url, "https://inpost.pl/sledzenie-przesylek?number=AB1")
  assert.equal(s.orders[0].carrier, "InPost")
})

test("demo: the simulated warehouse ships an order sent four minutes ago (at its pace), in the plugin's row only", async () => {
  const s = setup({ demo: true }, [{ order_id: "order_9", display_id: 9, bl_order_id: "9100001", bl_status_id: null, sent_at: new Date(Date.now() - 4 * 60 * 1000 * demoPace("order_9")) }])
  const stats = await syncStatuses(s.container, "auto")
  assert.equal(stats?.changed, 1)
  assert.equal(s.orders[0].bl_status_name, "Wysłane")
  assert.equal(s.orders[0].carrier, "InPost")
  assert.match(String(s.orders[0].tracking_number), /^\d{24}$/)
  assert.equal(s.metadata.has("order_9"), false, "a real order never gets a simulated status or parcel")
  assert.equal(s.events.length, 0, "no event for a simulation")
})

test("the database picks the candidates: never checked first, then the oldest check, closed statuses left out", async () => {
  fakeBaseLinker([])
  const old = new Date(Date.now() - 3 * 3600 * 1000)
  const rows: Row[] = []
  for (let i = 0; i < 70; i += 1) rows.push({ order_id: `order_c${i}`, bl_order_id: String(800 + i), bl_status_id: 4, sent_at: sentAt, status_checked_at: new Date(old.getTime() + i * 1000) })
  rows.push({ order_id: "order_new", bl_order_id: "900", bl_status_id: null, sent_at: sentAt, status_checked_at: null })
  rows.push({ order_id: "order_closed", bl_order_id: "901", bl_status_id: 9, sent_at: sentAt, status_checked_at: null })
  const s = setup(live, rows)
  const svc = s.container.resolve("baselinker") as Record<string, (...a: unknown[]) => Promise<unknown>>
  const list = svc.listBaseLinkerOrders
  const takes: unknown[] = []
  svc.listBaseLinkerOrders = async (...args: unknown[]) => {
    takes.push((args[1] as Row | undefined)?.take)
    return list(...args)
  }
  const stats = await syncStatuses(s.container, "manual")
  assert.equal(stats?.candidates, 60)
  assert.ok(!takes.includes(null) && !takes.includes(undefined), "never a read of every row")
  const checked = new Set(s.orders.filter((r) => r.status_checked_at && new Date(r.status_checked_at).getTime() > Date.now() - 60_000).map((r) => r.order_id))
  assert.ok(checked.has("order_new"), "the never checked order goes first")
  assert.ok(!checked.has("order_closed"), "a closed status is never read")
  assert.ok(checked.has("order_c0") && !checked.has("order_c69"), "then the oldest check")
})
