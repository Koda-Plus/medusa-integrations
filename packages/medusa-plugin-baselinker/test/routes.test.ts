/**
 * The admin routes as the dashboard calls them: every read only reads (no
 * write, no event, no network call, in demo mode too), the demo snapshot is
 * built by the job or the POST route, never by a read, and an unexpected
 * error answers a plain sentence.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import * as statusRoute from "../src/api/admin/baselinker/route.ts"
import * as ordersRoute from "../src/api/admin/baselinker/orders/route.ts"
import * as orderByMedusa from "../src/api/admin/baselinker/orders/by-medusa/[orderId]/route.ts"
import * as productsRoute from "../src/api/admin/baselinker/products/route.ts"
import * as productByMedusa from "../src/api/admin/baselinker/products/by-medusa/[productId]/route.ts"
import * as stockRoute from "../src/api/admin/baselinker/stock/route.ts"
import * as importsRoute from "../src/api/admin/baselinker/imports/route.ts"
import * as plansRoute from "../src/api/admin/baselinker/plans/route.ts"
import * as invoicesRoute from "../src/api/admin/baselinker/invoices/route.ts"
import * as returnsRoute from "../src/api/admin/baselinker/returns/route.ts"
import * as runsRoute from "../src/api/admin/baselinker/runs/route.ts"
import * as runningRoute from "../src/api/admin/baselinker/running/route.ts"
import * as prepareRoute from "../src/api/admin/baselinker/demo/prepare/route.ts"
import { prepareDemo, runDemoTick } from "../src/workflows/baselinker/demo.ts"
import { call, storeFixture, storeOrder } from "./store.ts"

type Handler = (req: never, res: never) => Promise<void>

const READS: Array<[string, Handler, Record<string, unknown>]> = [
  ["status", statusRoute.GET as Handler, {}],
  ["orders", ordersRoute.GET as Handler, { query: { filter: "all" } }],
  ["order widget", orderByMedusa.GET as Handler, { params: { orderId: "order_1" } }],
  ["cards", productsRoute.GET as Handler, { query: { filter: "conflicts", q: "OP" } }],
  ["product widget", productByMedusa.GET as Handler, { params: { productId: "prod_a" } }],
  ["stock", stockRoute.GET as Handler, { query: { q: "OP-A" } }],
  ["imports", importsRoute.GET as Handler, { query: { filter: "failed" } }],
  ["plans", plansRoute.GET as Handler, { query: { kind: "cards" } }],
  ["invoices", invoicesRoute.GET as Handler, {}],
  ["returns", returnsRoute.GET as Handler, {}],
  ["runs", runsRoute.GET as Handler, {}],
  ["running", runningRoute.GET as Handler, {}],
]

const TOKEN = "5012345-5067890-QWERTYUIOPASDFGHJKLZXCVBNM1234567890ABCDEFGHIJKLMNOP"
const live = { apiToken: TOKEN, inventoryId: 1, warehouseId: "bl_1", orderStatusId: 1 }

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

function orders() {
  return [storeOrder("order_1", 1), storeOrder("order_2", 2), storeOrder("order_3", 3, { status: "canceled" })]
}

test("demo: the job builds the snapshot and sends the latest orders through the simulation, never into the orders themselves", async () => {
  const t = storeFixture({ demo: true }, orders())
  cleanup = t.restore
  const first = await prepareDemo(t.container)
  assert.equal(first?.prepared, true)
  assert.equal(first?.built, true)
  assert.equal(first?.sent, 2, "the canceled order stays out")
  assert.ok(t.s.table("Orders").rows.every((r) => r.demo === true && r.status === "sent"))
  assert.deepEqual(t.metadataWrites, [], "no simulated number in a real order")
  assert.deepEqual(t.events, [], "no event for a simulation")
  const second = await prepareDemo(t.container)
  assert.equal(second?.built, false, "idempotent")
  assert.equal(second?.sent, 0)
})

for (const mode of ["demo", "live"] as const) {
  test(`${mode}: every admin read only reads: no write, no event, no network call`, async () => {
    const t = storeFixture(mode === "demo" ? { demo: true } : live, orders())
    cleanup = t.restore
    if (mode === "demo") await runDemoTick(t.container)
    t.record()
    for (const [name, handler, input] of READS) {
      const { req, res, out } = call(t.container, input)
      await handler(req, res)
      assert.equal(out.statusCode, 200, `${name} answers 200`)
      assert.ok(out.body, `${name} answers a body`)
    }
    assert.deepEqual(t.writes, [], "no write to the plugin tables")
    assert.deepEqual(t.metadataWrites, [], "no write to Medusa orders")
    assert.deepEqual(t.events, [], "no event")
    assert.deepEqual(t.network, [], "no call to BaseLinker")
    if (mode === "demo") {
      /* The recorder sees writes: the demo job, unlike a read, moves the simulated warehouse on. */
      await runDemoTick(t.container)
      assert.ok(t.writes.length > 0)
      assert.deepEqual(t.metadataWrites, [], "even the job never writes into the orders")
    }
  })
}

test("the status says when the demo snapshot is missing; POST demo/prepare builds it, and refuses outside demo mode", async () => {
  const t = storeFixture({ demo: true }, orders())
  cleanup = t.restore
  t.record()
  const before = call(t.container)
  await (statusRoute.GET as Handler)(before.req, before.res)
  assert.deepEqual((before.out.body as { demo: unknown }).demo, { prepared: false, createsOrders: false })
  assert.deepEqual(t.writes, [], "the read did not build it")
  t.restore()

  const post = call(t.container, { method: "POST", body: {} })
  await (prepareRoute.POST as Handler)(post.req, post.res)
  assert.equal(post.out.statusCode, 200)
  assert.equal((post.out.body as { prepared: boolean }).prepared, true)
  assert.equal((post.out.body as { status: { demo: { prepared: boolean } } }).status.demo.prepared, true)

  const l = storeFixture(live, orders())
  const refused = call(l.container, { method: "POST", body: {} })
  await (prepareRoute.POST as Handler)(refused.req, refused.res)
  assert.equal(refused.out.statusCode, 409)
})

test("GET /running answers what runs in any process from the job leases", async () => {
  const t = storeFixture(live, orders())
  cleanup = t.restore
  t.s.table("Settings").create({ key: "lease:job:catalog", demo: false, value: { owner: "worker", until: new Date(Date.now() + 60_000).toISOString() } })
  t.s.table("Settings").create({ key: "lease:job:orders", demo: false, value: { owner: "dead", until: new Date(Date.now() - 1000).toISOString() } })
  const { req, res, out } = call(t.container)
  await (runningRoute.GET as Handler)(req, res)
  assert.deepEqual(out.body, { running: ["catalog"], demoPrepared: null })
})

test("an unexpected error answers a plain sentence; the details stay in the server log, masked", async () => {
  const t = storeFixture(live, orders())
  cleanup = t.restore
  const svc = t.container.resolve("baselinker") as Record<string, unknown>
  const inner = t.s.svc as Record<string, unknown>
  inner.listAndCountBaseLinkerOrders = async () => {
    throw new Error(`relation "baselinker_order" does not exist (token ${TOKEN})`)
  }
  assert.ok(svc)
  const { req, res, out } = call(t.container, { query: { filter: "failed" } })
  await (ordersRoute.GET as Handler)(req, res)
  assert.equal(out.statusCode, 500)
  const body = out.body as { message: string }
  assert.doesNotMatch(body.message, /relation|baselinker_order/)
  const logged = t.s.logs.find((l) => l.startsWith("error"))
  assert.match(String(logged), /relation "baselinker_order"/)
  assert.doesNotMatch(String(logged), new RegExp(TOKEN))
})
